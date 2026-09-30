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

/** `z.toJSONSchema()`'s output, minus the top-level `$schema` key — OpenAPI Schema Objects don't carry that. */
function toSchema(schema: ZodType): JsonSchema {
  const { $schema: _unused, ...rest } = z.toJSONSchema(schema);
  return rest;
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
          schema: source.schema ? toSchema(source.schema) : { type: "string" },
        });
        break;
      case "query":
        if (source.schema instanceof z.ZodObject) {
          for (const [name, fieldSchema] of Object.entries(source.schema.shape)) {
            parameters.push({
              name,
              in: "query",
              required: !fieldSchema.isOptional(),
              schema: toSchema(fieldSchema),
            });
          }
        }
        break;
      case "headers":
        if (source.name) {
          parameters.push({ name: source.name, in: "header", required: false, schema: { type: "string" } });
        }
        break;
      case "body":
        if (source.schema) {
          requestBody = { required: true, content: { "application/json": { schema: toSchema(source.schema) } } };
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
      ? { description: "Success", content: { "application/json": { schema: toSchema(returnsSchema) } } }
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
