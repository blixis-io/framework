import type { Class } from "@blixis-io/di";
import {
  getApiOperation,
  getClassApiTags,
  getControllerPrefix,
  getHttpCode,
  getMethodApiTags,
  getParamSources,
  getReturnsSchema,
  getRoutes,
  type RouteDefinition,
} from "@blixis-io/http";
import { z, type ZodType } from "zod";

/** The one thing `generateOpenApiDocument` needs — a real `HttpApplication` satisfies this structurally, no import of the class itself required. */
export interface ControllerSource {
  readonly controllers: readonly Class[];
}

export type JsonSchema = Record<string, unknown>;

export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  schema: JsonSchema;
}

export interface OpenApiResponse {
  description: string;
  content?: { "application/json": { schema: JsonSchema } };
}

export interface OpenApiOperation {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: { required: boolean; content: { "application/json": { schema: JsonSchema } } };
  responses: Record<string, OpenApiResponse>;
}

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { schemas: { Problem: JsonSchema } };
}

export interface OpenApiDocumentOptions {
  title: string;
  version: string;
  description?: string;
}

const PROBLEM_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    type: { type: "string" },
    title: { type: "string" },
    status: { type: "integer" },
    detail: { type: "string" },
  },
  required: ["type", "title", "status", "detail"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `z.toJSONSchema()`'s output, minus the top-level `$schema` key (OpenAPI Schema Objects don't carry it).
 *
 * `io` says which side of the schema to describe. A request is described by what the client **sends** (`"input"`:
 * a field with a `.default()` is optional, a `.transform()` is its input type), a response by what the server
 * **returns** (`"output"`: the default has been applied, so the field is always there).
 *
 * Nothing here may fail the whole document. Types JSON Schema has no equivalent for (`.transform()` output,
 * `z.custom()`) become an open schema (`{}`), a `z.date()` becomes a `date-time` string (what JSON serialization
 * makes of it), and a schema that can't be converted at all becomes an open schema that says so in its description.
 */
function toSchema(schema: ZodType, io: "input" | "output"): JsonSchema {
  try {
    const { $schema: _unused, ...rest } = z.toJSONSchema(schema, {
      io,
      unrepresentable: "any",
      override: ({ zodSchema, jsonSchema }) => {
        // `instanceof` on Zod's own classes checks traits, not identity, so it also holds across two copies of Zod.
        if (zodSchema instanceof z.ZodDate) {
          jsonSchema.type = "string";
          jsonSchema.format = "date-time";
        }
      },
    });
    return rest;
  } catch (error) {
    return { description: `Schema could not be converted to JSON Schema: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * One query parameter per property of the schema's input shape, whatever wrapped the object (`.refine()`,
 * `.transform()`, `.strict()`): read from the JSON Schema rather than from the Zod class, so it can't be defeated by
 * a wrapper or by a second copy of Zod. A key is required only when it has neither a default nor `.optional()`.
 */
function queryParameters(schema: ZodType): OpenApiParameter[] {
  const converted = toSchema(schema, "input");
  const properties = converted["properties"];
  if (converted["type"] !== "object" || !isRecord(properties)) {
    return [];
  }
  const required = Array.isArray(converted["required"]) ? converted["required"] : [];
  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: "query",
    required: required.includes(name),
    schema: isRecord(property) ? property : {},
  }));
}

/**
 * Converts one route's path segments to an OpenAPI path template
 * (`:id` → `{id}`), or `undefined` if the route contains a `*` wildcard
 * segment — OpenAPI has no equivalent construct, so wildcard routes are
 * excluded from the generated document entirely.
 */
function buildOpenApiPath(prefix: string, routePath: string): string | undefined {
  const segments = `${prefix}/${routePath}`.split("/").filter((segment) => segment.length > 0);
  if (segments.includes("*")) {
    return undefined;
  }
  const converted = segments.map((segment) => (segment.startsWith(":") ? `{${segment.slice(1)}}` : segment));
  return `/${converted.join("/")}`;
}

function buildParameters(prototype: object, propertyKey: string | symbol): {
  parameters: OpenApiParameter[];
  requestBody: OpenApiOperation["requestBody"];
} {
  const parameters: OpenApiParameter[] = [];
  let requestBody: OpenApiOperation["requestBody"];

  for (const source of getParamSources(prototype, propertyKey).values()) {
    switch (source.kind) {
      case "param":
        parameters.push({
          name: source.name,
          in: "path",
          required: true,
          schema: source.schema ? toSchema(source.schema, "input") : { type: "string" },
        });
        break;
      case "query":
        if (source.schema) {
          parameters.push(...queryParameters(source.schema));
        }
        break;
      case "headers":
        if (source.name) {
          parameters.push({ name: source.name, in: "header", required: false, schema: { type: "string" } });
        }
        break;
      case "body":
        if (source.schema) {
          requestBody = { required: true, content: { "application/json": { schema: toSchema(source.schema, "input") } } };
        }
        break;
      // `req` (the raw Request) has nothing documentable — no case needed.
    }
  }

  return { parameters, requestBody };
}

function buildResponses(prototype: object, propertyKey: string | symbol): Record<string, OpenApiResponse> {
  const status = String(getHttpCode(prototype, propertyKey) ?? 200);
  const returnsSchema = getReturnsSchema(prototype, propertyKey);

  return {
    [status]: returnsSchema
      ? { description: "Success", content: { "application/json": { schema: toSchema(returnsSchema, "output") } } }
      : { description: "Success" },
    default: {
      description: "Error",
      content: { "application/json": { schema: { $ref: "#/components/schemas/Problem" } } },
    },
  };
}

function buildOperation(controller: Class, route: RouteDefinition): OpenApiOperation {
  const prototype = controller.prototype as object;
  const operation = getApiOperation(prototype, route.propertyKey);
  const tags = [...getClassApiTags(controller), ...getMethodApiTags(prototype, route.propertyKey)];
  const { parameters, requestBody } = buildParameters(prototype, route.propertyKey);

  return {
    operationId: operation?.operationId ?? `${controller.name}_${String(route.propertyKey)}`,
    ...(operation?.summary ? { summary: operation.summary } : {}),
    ...(operation?.description ? { description: operation.description } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses: buildResponses(prototype, route.propertyKey),
  };
}

/**
 * Builds an OpenAPI 3.1 document from `app`'s real controller list —
 * walking the same public decorator-metadata readers `@blixis-io/http`'s own
 * `buildRouter` uses internally, so the document always reflects the
 * routes actually registered, not a separately-maintained description of
 * them. Returns a plain object; mount it yourself (`@Get("openapi.json")
 * spec() { return generateOpenApiDocument(...); }`) — no serving
 * mechanism or bundled UI here.
 */
export function generateOpenApiDocument(app: ControllerSource, options: OpenApiDocumentOptions): OpenApiDocument {
  const paths: OpenApiDocument["paths"] = {};

  for (const controller of app.controllers) {
    const prefix = getControllerPrefix(controller) ?? "";

    for (const route of getRoutes(controller)) {
      const path = buildOpenApiPath(prefix, route.path);
      if (!path) {
        continue;
      }

      paths[path] ??= {};
      paths[path][route.method.toLowerCase()] = buildOperation(controller, route);
    }
  }

  return {
    openapi: "3.1.0",
    info: { title: options.title, version: options.version, ...(options.description ? { description: options.description } : {}) },
    paths,
    components: { schemas: { Problem: PROBLEM_SCHEMA } },
  };
}

/** What `serveOpenApi` needs on top of `ControllerSource` — a real `HttpApplication` satisfies it structurally. */
export interface MountableApp extends ControllerSource {
  mount(method: "GET", path: string, handler: () => Response): void;
}

/**
 * Serves the generated document at `path` (GET), built once on first request — the controller list
 * is fixed after boot. The route is public (mounted routes bypass guards); generation itself works
 * without it via `generateOpenApiDocument`.
 */
export function serveOpenApi(app: MountableApp, path: string, options: OpenApiDocumentOptions): void {
  let body: string | undefined;
  app.mount("GET", path, () => {
    body ??= JSON.stringify(generateOpenApiDocument(app, options));
    return new Response(body, { headers: { "content-type": "application/json" } });
  });
}
