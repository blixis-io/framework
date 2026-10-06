import type { Application } from "@blixis-io/core";
import type { Class } from "@blixis-io/di";
import type { ZodType } from "zod";
import { getControllerPrefix } from "./decorators/controller.js";
import { getClassGuards, getMethodGuards, isGlobalGuard, type CanActivate } from "./decorators/guards.js";
import { getClassInterceptors, getMethodInterceptors, type Interceptor } from "./decorators/interceptors.js";
import { getParamSources, type ParamSource } from "./decorators/params.js";
import { getHttpCode, getReturnsSchema, getReturnsValidate, getRoutes } from "./decorators/routes.js";
import {
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "./exceptions.js";
import { resolveHandlerArgs } from "./params.js";
import { runInRequestContext } from "./request-context.js";
import { validateResponse } from "./response.js";
import { Router } from "./router.js";
import { statusTitle } from "./status-titles.js";
import type { HttpMethod } from "./types.js";

const DEFAULT_BODY_LIMIT = 1024 * 1024; // 1 MiB

export interface HandlerOptions {
  bodyLimit?: number;
  /**
   * Milliseconds a request may take before the client gets a 504. Off by default. The budget covers the whole
   * request: routing, guards, argument parsing, interceptors and the handler, and a handler passed to `mount()`.
   * Nothing is killed: the work keeps running and sees the timeout through `request.signal` (`@Req()`, and the
   * `request` a guard or interceptor receives), and must pass that signal on to cancellable work (`fetch`, DB
   * queries) to actually stop. What the framework does stop is *starting* more: once the budget has run out (or the
   * client has left), the next guard and the controller method are not called.
   */
  requestTimeout?: number;
  /**
   * `"always"` (default) validates every `@Returns` route and sends the parsed value, so the schema also
   * strips unknown keys. `"never"` sends handler values as-is, which skips that stripping: an object with
   * extra fields (say a `passwordHash`) is then sent whole. A route's `@Returns(..., { validate })` wins.
   */
  responseValidation?: "always" | "never";
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
  /** Per-route `@Returns(..., { validate })` override; `undefined` follows the app-wide `responseValidation`. */
  validateResponse?: boolean | undefined;
  guards: Class<CanActivate>[];
  interceptors: Class<Interceptor>[];
}

/**
 * Flattens every `@Controller`'s route metadata into one `Router`. Guard
 * classes referenced via `@UseGuards` must also be registered as providers
 * on the owning module — this doesn't instantiate them, it only records
 * which classes `createHandler` will later ask the `Application` for.
 */
/** Guard classes marked `@GlobalGuard()` among the application's resolved providers, in dependency order. */
function discoverGlobalGuards(application: Application): Class<CanActivate>[] {
  const found: Class<CanActivate>[] = [];
  for (const [, instance] of application.resolved()) {
    if (typeof instance !== "object" || instance === null || !isGlobalGuard(instance.constructor)) {
      continue;
    }
    const guardClass: unknown = instance.constructor;
    if (!isGuardClass(guardClass)) {
      throw new TypeError(`${instance.constructor.name} is marked @GlobalGuard() but has no canActivate() method.`);
    }
    found.push(guardClass);
  }
  return found;
}

function isGuardClass(value: unknown): value is Class<CanActivate> {
  return typeof value === "function" && typeof value.prototype === "object" && value.prototype !== null && "canActivate" in value.prototype;
}

export function buildRouter(controllers: readonly Class[], globalGuards: readonly Class<CanActivate>[] = []): Router<RouteEntry> {
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
        validateResponse: getReturnsValidate(prototype, route.propertyKey),
        guards: [...globalGuards, ...classGuards, ...getMethodGuards(prototype, route.propertyKey)],
        interceptors: [...classInterceptors, ...getMethodInterceptors(prototype, route.propertyKey)],
      });
    }
  }

  return router;
}

/**
 * Reads the stream chunk by chunk and cancels it the moment `limit` bytes are exceeded, so a chunked body without a `Content-Length` can't be buffered whole before being rejected.
 * A stream that errors (the client disconnected or closed the connection mid-body) is the client's fault, so it becomes a 400 instead of an unexpected, logged 500.
 */
async function readBodyText(body: ReadableStream<Uint8Array>, limit: number): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read().catch(() => {
      throw new BadRequestException("Request body was not fully received");
    });
    if (done) {
      return text + decoder.decode();
    }
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel();
      throw new PayloadTooLargeException();
    }
    text += decoder.decode(value, { stream: true });
  }
}

/**
 * Accepts `application/json` and structured-syntax JSON types (`application/vnd.api+json`), compared as whole media
 * types: `application/jsonp` and `application/json5` are not JSON for this purpose. A `charset` other than UTF-8 is
 * refused, since the body is always decoded as UTF-8 and would otherwise be silently misread.
 */
function assertJsonContentType(contentType: string): void {
  const [mediaType = "", ...parameters] = contentType.split(";");
  const type = mediaType.trim().toLowerCase();
  const isJson = type === "application/json" || (/^application\/[^/\s]+\+json$/.test(type));
  if (!isJson) {
    throw new UnsupportedMediaTypeException();
  }
  for (const parameter of parameters) {
    const charset = /^\s*charset\s*=\s*"?([^";\s]+)"?\s*$/i.exec(parameter)?.[1]?.toLowerCase();
    if (charset !== undefined && charset !== "utf-8" && charset !== "utf8") {
      throw new UnsupportedMediaTypeException("JSON request bodies must be UTF-8");
    }
  }
}

async function readJsonBody(request: Request, bodyLimit: number): Promise<unknown> {
  if (request.body === null) {
    return undefined;
  }

  assertJsonContentType(request.headers.get("content-type") ?? "");

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > bodyLimit) {
    throw new PayloadTooLargeException();
  }

  const text = await readBodyText(request.body, bodyLimit);
  if (text.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequestException("Invalid JSON body");
  }
}

function problemResponse(status: number, detail: string, extra?: Record<string, unknown>, headers?: Readonly<Record<string, string>>): Response {
  const body = {
    type: "about:blank",
    title: statusTitle(status),
    status,
    detail,
    ...extra,
  };
  // The content type goes last so an exception's own headers can't turn the problem document into something else.
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/problem+json" } });
}

function exceptionToResponse(error: unknown): Response {
  if (error instanceof HttpException) {
    return problemResponse(error.status, error.detail, error.extra, error.headers);
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
async function toResponse(
  value: unknown,
  httpCode: number | undefined,
  responseSchema: ZodType | undefined,
  validate: boolean,
): Promise<Response> {
  if (value instanceof Response) {
    return value;
  }
  if (value === undefined) {
    return new Response(null, { status: httpCode ?? 204 });
  }
  const validated = validate ? await validateResponse(responseSchema, value) : value;
  return new Response(JSON.stringify(validated), {
    status: httpCode ?? 200,
    headers: { "content-type": "application/json" },
  });
}

/** Same request, but its `signal` also fires after `ms` — so handlers see the timeout via `request.signal`. */
function withTimeout(request: Request, ms: number): Request {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(ms)]);
  return new Request(request, { signal });
}

/** Settles with `work`, unless `signal` aborts first: a client disconnect becomes a 499, a timeout a 504. `work` keeps running; its late result/rejection is ignored. */
function raceAbort(work: Promise<Response>, signal: AbortSignal, clientSignal: AbortSignal): Promise<Response> {
  const abortResponse = (): Response =>
    clientSignal.aborted ? new Response(null, { status: 499 }) : exceptionToResponse(new GatewayTimeoutException());
  if (signal.aborted) {
    return Promise.resolve(abortResponse());
  }
  return new Promise<Response>((resolve, reject) => {
    const onAbort = (): void => {
      resolve(abortResponse());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

/**
 * Runs `run` against `incoming`, giving it the `requestTimeout` budget (none when `undefined`). The request `run`
 * receives carries the deadline in its `signal`; a late result is ignored. Shared by the router and by `mount()`.
 */
export function runWithDeadline(
  incoming: Request,
  requestTimeout: number | undefined,
  run: (request: Request) => Promise<Response>,
): Promise<Response> {
  if (requestTimeout === undefined) {
    return run(incoming);
  }
  const request = withTimeout(incoming, requestTimeout);
  return raceAbort(run(request), request.signal, incoming.signal);
}

/** Builds a single `(Request) => Promise<Response>` function serving every controller's routes. */
export function createHandler(
  controllers: readonly Class[],
  application: Application,
  options: HandlerOptions = {},
): (request: Request) => Promise<Response> {
  const router = buildRouter(controllers, discoverGlobalGuards(application));
  const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;

  const requestTimeout = options.requestTimeout;
  const validateByDefault = options.responseValidation !== "never";

  return function handle(incoming: Request): Promise<Response> {
    return runWithDeadline(incoming, requestTimeout, async (request) => {
      const url = new URL(request.url);
      const match = router.match(request.method as HttpMethod, url.pathname);

      if (match.kind === "malformed-path") {
        return problemResponse(400, "Malformed percent-encoding in the request path");
      }

      if (match.kind === "not-found") {
        return problemResponse(404, "No route matches this path");
      }
      if (match.kind === "method-not-allowed") {
        const response = problemResponse(405, `Allowed methods: ${match.allowed.join(", ")}`);
        response.headers.set("allow", match.allowed.join(", "));
        return response;
      }

      const route = match.handler;

      // With a deadline set, an aborted signal (budget spent, or the client gone) means nobody will read the result, so
      // a guard or handler that settles late must not start more work. Without one, a request runs to completion as before.
      const stopIfAbandoned = (): void => {
        if (requestTimeout !== undefined && request.signal.aborted) {
          throw new GatewayTimeoutException();
        }
      };

      return runInRequestContext(async () => {
        try {
          // Sequential and short-circuiting on purpose: a later guard must not
          // run once an earlier one has already denied the request.
          for (const guardClass of route.guards) {
            const guard = application.get(guardClass);
            const allowed = await guard.canActivate({ request, params: match.params, controller: route.controller, handler: route.propertyKey });
            stopIfAbandoned();
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
            stopIfAbandoned();

            const instance = application.get(route.controller) as Record<PropertyKey, (...args: unknown[]) => unknown>;
            const result: unknown = await instance[route.propertyKey]?.(...args);

            return toResponse(result, route.httpCode, route.responseSchema, route.validateResponse ?? validateByDefault);
          };

          // Class-level interceptors wrap outermost, method-level innermost —
          // built right-to-left so the first entry ends up as the outer call.
          const pipeline = route.interceptors.reduceRight<() => Promise<Response>>((next, interceptorClass) => {
            const interceptor = application.get(interceptorClass);
            return async () => interceptor.intercept({ request, params: match.params, controller: route.controller, handler: route.propertyKey }, next);
          }, invoke);

          return await pipeline();
        } catch (error) {
          return exceptionToResponse(error);
        }
      });
    });
  };
}
