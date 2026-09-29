import type { Application } from "@blixis/core";
import type { Class } from "@blixis/di";
import type { ZodType } from "zod";
import { getControllerPrefix } from "./decorators/controller.js";
import { getClassGuards, getMethodGuards, type CanActivate } from "./decorators/guards.js";
import { getClassInterceptors, getMethodInterceptors, type Interceptor } from "./decorators/interceptors.js";
import { getParamSources, type ParamSource } from "./decorators/params.js";
import { getHttpCode, getReturnsSchema, getRoutes } from "./decorators/routes.js";
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "./exceptions.js";
import { resolveHandlerArgs } from "./params.js";
import { runInRequestContext } from "./request-context.js";
import { validateResponse } from "./response.js";
import { Router } from "./router.js";
import type { HttpMethod } from "./types.js";

const DEFAULT_BODY_LIMIT = 1024 * 1024; // 1 MiB

export interface HandlerOptions {
  bodyLimit?: number;
}

export class NotAControllerError extends Error {
  override readonly name = "NotAControllerError";

  constructor(target: { name: string }) {
    super(`${target.name} is not a controller — did you forget @Controller()?`);
  }
}

interface RouteEntry {
  controller: Class;
  propertyKey: string | symbol;
  paramSources: ReadonlyMap<number, ParamSource>;
  httpCode?: number | undefined;
  responseSchema?: ZodType | undefined;
  guards: Class<CanActivate>[];
  interceptors: Class<Interceptor>[];
}

/**
 * Flattens every `@Controller`'s route metadata into one `Router`. Guard
 * classes referenced via `@UseGuards` must also be registered as providers
 * on the owning module — this doesn't instantiate them, it only records
 * which classes `createHandler` will later ask the `Application` for.
 */
export function buildRouter(controllers: readonly Class[]): Router<RouteEntry> {
  const router = new Router<RouteEntry>();

  for (const controller of controllers) {
    const prefix = getControllerPrefix(controller);
    if (prefix === undefined) {
      throw new NotAControllerError(controller);
    }

    const prototype = controller.prototype as object;
    const classGuards = getClassGuards(controller);
    const classInterceptors = getClassInterceptors(controller);

    for (const route of getRoutes(controller)) {
      router.add(route.method, `/${prefix}/${route.path}`, {
        controller,
        propertyKey: route.propertyKey,
        paramSources: getParamSources(prototype, route.propertyKey),
        httpCode: getHttpCode(prototype, route.propertyKey),
        responseSchema: getReturnsSchema(prototype, route.propertyKey),
        guards: [...classGuards, ...getMethodGuards(prototype, route.propertyKey)],
        interceptors: [...classInterceptors, ...getMethodInterceptors(prototype, route.propertyKey)],
      });
    }
  }

  return router;
}

async function readJsonBody(request: Request, bodyLimit: number): Promise<unknown> {
  if (request.body === null) {
    return undefined;
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new UnsupportedMediaTypeException();
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > bodyLimit) {
    throw new PayloadTooLargeException();
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).length > bodyLimit) {
    throw new PayloadTooLargeException();
  }
  if (text.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequestException("Invalid JSON body");
  }
}

const STATUS_TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  500: "Internal Server Error",
};

function problemResponse(status: number, detail: string, extra?: Record<string, unknown>): Response {
  const body = {
    type: "about:blank",
    title: STATUS_TITLES[status] ?? "Error",
    status,
    detail,
    ...extra,
  };
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/problem+json" } });
}

function exceptionToResponse(error: unknown): Response {
  if (error instanceof HttpException) {
    return problemResponse(error.status, error.detail, error.extra);
  }
  // Internal errors are logged but never surfaced to the client.
  console.error(error);
  return problemResponse(500, "An unexpected error occurred");
}

/**
 * A raw `Response` or an `undefined` (204) return bypasses `responseSchema`
 * entirely — both are deliberate escape hatches from the normal JSON path,
 * not a value the schema was ever meant to describe.
 */
async function toResponse(value: unknown, httpCode: number | undefined, responseSchema: ZodType | undefined): Promise<Response> {
  if (value instanceof Response) {
    return value;
  }
  if (value === undefined) {
    return new Response(null, { status: httpCode ?? 204 });
  }
  const validated = await validateResponse(responseSchema, value);
  return new Response(JSON.stringify(validated), {
    status: httpCode ?? 200,
    headers: { "content-type": "application/json" },
  });
}

/** Builds a single `(Request) => Promise<Response>` function serving every controller's routes. */
export function createHandler(
  controllers: readonly Class[],
  application: Application,
  options: HandlerOptions = {},
): (request: Request) => Promise<Response> {
  const router = buildRouter(controllers);
  const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = router.match(request.method as HttpMethod, url.pathname);

    if (match.kind === "not-found") {
      return problemResponse(404, "No route matches this path");
    }
    if (match.kind === "method-not-allowed") {
      const response = problemResponse(405, `Allowed methods: ${match.allowed.join(", ")}`);
      response.headers.set("allow", match.allowed.join(", "));
      return response;
    }

    const route = match.handler;

    return runInRequestContext(async () => {
      try {
        // Sequential and short-circuiting on purpose: a later guard must not
        // run once an earlier one has already denied the request.
        for (const guardClass of route.guards) {
          const guard = application.get(guardClass);
          const allowed = await guard.canActivate({ request, params: match.params });
          if (!allowed) {
            throw new ForbiddenException();
          }
        }

        const invoke = async (): Promise<Response> => {
          let cachedBody: { value: unknown } | undefined;
          const args = await resolveHandlerArgs(route.paramSources, {
            request,
            routeParams: match.params,
            getBody: async () => {
              cachedBody ??= { value: await readJsonBody(request, bodyLimit) };
              return cachedBody.value;
            },
          });

          const instance = application.get(route.controller) as Record<PropertyKey, (...args: unknown[]) => unknown>;
          const result: unknown = await instance[route.propertyKey]?.(...args);

          return toResponse(result, route.httpCode, route.responseSchema);
        };

        // Class-level interceptors wrap outermost, method-level innermost —
        // built right-to-left so the first entry ends up as the outer call.
        const pipeline = route.interceptors.reduceRight<() => Promise<Response>>((next, interceptorClass) => {
          const interceptor = application.get(interceptorClass);
          return async () => interceptor.intercept({ request, params: match.params }, next);
        }, invoke);

        return await pipeline();
      } catch (error) {
        return exceptionToResponse(error);
      }
    });
  };
}
