import { defineMetadata, getMetadata, type Class } from "@blixis-io/di";
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
  /** Media type to schema: `application/json` for a success body, `application/problem+json` for errors. */
  content?: Record<string, { schema: JsonSchema }>;
}

/** A Security Scheme Object as OpenAPI defines it (`{ type: "http", scheme: "bearer" }`, `{ type: "apiKey", ... }`). Passed through as given. */
export type OpenApiSecurityScheme = { type: string } & Record<string, unknown>;

/** One alternative a request may satisfy: scheme name to the scopes it needs (`[]` for schemes without scopes). */
export type OpenApiSecurityRequirement = Record<string, string[]>;

export interface OpenApiOperation {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: { required: boolean; content: { "application/json": { schema: JsonSchema } } };
  responses: Record<string, OpenApiResponse>;
  /** Present only when the route says so with `@ApiSecurity`; an empty array marks a public route that overrides the document's `security`. */
  security?: OpenApiSecurityRequirement[];
}

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
  /** Present only when `OpenApiDocumentOptions.security` is. */
  security?: OpenApiSecurityRequirement[];
  components: { schemas: { Problem: JsonSchema }; securitySchemes?: Record<string, OpenApiSecurityScheme> };
}

/** What to do with a schema JSON Schema cannot express (`z.custom()`, a `.transform()`'s output, a schema that fails to convert). */
export type UnrepresentableMode = "open" | "warn" | "throw";

export interface OpenApiDocumentOptions {
  title: string;
  version: string;
  description?: string;
  /** Security schemes to declare under `components.securitySchemes`, keyed by the name `@ApiSecurity` and `security` refer to. */
  securitySchemes?: Record<string, OpenApiSecurityScheme>;
  /** Requirements that apply to every operation unless a route overrides them with `@ApiSecurity`. */
  security?: (string | OpenApiSecurityRequirement)[];
  /**
   * `"open"` (default) documents a schema that cannot be expressed as an open schema, silently. `"warn"` does the
   * same and logs which route and schema it was. `"throw"` fails generation, for a build that must not ship an open schema.
   */
  onUnrepresentable?: UnrepresentableMode;
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

const PROBLEM_MEDIA_TYPE = "application/problem+json";

const API_SECURITY = Symbol("blixis:api-security");

type SecurityInput = string | OpenApiSecurityRequirement;

function toRequirements(inputs: readonly SecurityInput[]): OpenApiSecurityRequirement[] {
  return inputs.map((input) => (typeof input === "string" ? { [input]: [] } : input));
}

/**
 * Declares which security scheme a controller (class position) or one route (method position) needs, for the
 * generated document only; it enforces nothing, guards do. Each argument is one alternative: a scheme name, or
 * `{ oauth: ["read"] }` to name scopes. `@ApiSecurity(false)` marks a public route, overriding the document-wide
 * `security`. A method's own value wins over its controller's. Every name must be declared in `securitySchemes`.
 */
export function ApiSecurity(...requirements: [false] | SecurityInput[]): ClassDecorator & MethodDecorator {
  const value = requirements[0] === false ? [] : toRequirements(requirements as SecurityInput[]);
  const decorator = (target: object, propertyKey?: string | symbol): void => {
    if (propertyKey === undefined) {
      defineMetadata(API_SECURITY, value, target);
    } else {
      defineMetadata(API_SECURITY, value, target, propertyKey);
    }
  };
  return decorator;
}

function getRouteSecurity(controller: Class, propertyKey: string | symbol): OpenApiSecurityRequirement[] | undefined {
  return getMetadata<OpenApiSecurityRequirement[]>(API_SECURITY, controller.prototype as object, propertyKey) ?? getMetadata<OpenApiSecurityRequirement[]>(API_SECURITY, controller);
}

/** Where a schema came from, and what to do when it cannot be expressed: threaded through every conversion so a message can name the route. */
interface SchemaContext {
  where: string;
  mode: UnrepresentableMode;
}

function reportOpen(context: SchemaContext, reason: string): void {
  const message = `${context.where}: ${reason}, documented as an open schema`;
  if (context.mode === "throw") {
    throw new Error(`[@blixis-io/openapi] ${message}`);
  }
  if (context.mode === "warn") {
    console.warn(`[@blixis-io/openapi] ${message}`);
  }
}

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
function toSchema(schema: ZodType, io: "input" | "output", context: SchemaContext): JsonSchema {
  try {
    const { $schema: _unused, ...rest } = z.toJSONSchema(schema, {
      io,
      unrepresentable: "any",
      override: ({ zodSchema, jsonSchema }) => {
        // `instanceof` on Zod's own classes checks traits, not identity, so it also holds across two copies of Zod.
        if (zodSchema instanceof z.ZodDate) {
          jsonSchema.type = "string";
          jsonSchema.format = "date-time";
          return;
        }
        // `z.any()` and `z.unknown()` are open on purpose; anything else that came out empty could not be expressed.
        // eslint-disable-next-line no-underscore-dangle -- the override callback is handed Zod core schemas, which only expose `_zod`
        const type = zodSchema._zod.def.type;
        if (type !== "any" && type !== "unknown" && Object.keys(jsonSchema).length === 0) {
          reportOpen(context, `a \`${type}\` schema (${io} side) has no JSON Schema equivalent`);
        }
      },
    });
    return rest;
  } catch (error) {
    // A strict-mode report from the override above is the caller's answer, not a conversion failure.
    if (context.mode === "throw" && error instanceof Error && error.message.startsWith("[@blixis-io/openapi]")) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    reportOpen(context, `the schema could not be converted to JSON Schema (${reason})`);
    return { description: `Schema could not be converted to JSON Schema: ${reason}` };
  }
}

/**
 * One query parameter per property of the schema's input shape, whatever wrapped the object (`.refine()`,
 * `.transform()`, `.strict()`): read from the JSON Schema rather than from the Zod class, so it can't be defeated by
 * a wrapper or by a second copy of Zod. A key is required only when it has neither a default nor `.optional()`.
 */
function queryParameters(schema: ZodType, context: SchemaContext): OpenApiParameter[] {
  const converted = toSchema(schema, "input", context);
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

/** Whether a missing value passes the schema: the handler reads an empty body as `undefined`, so then the body is optional. */
function acceptsUndefined(schema: ZodType): boolean {
  try {
    return schema.safeParse(undefined).success;
  } catch {
    // An async refinement cannot be checked synchronously; treat the body as required.
    return false;
  }
}

function buildParameters(prototype: object, propertyKey: string | symbol, context: SchemaContext): {
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
          schema: source.schema ? toSchema(source.schema, "input", context) : { type: "string" },
        });
        break;
      case "query":
        if (source.schema) {
          parameters.push(...queryParameters(source.schema, context));
        }
        break;
      case "headers":
        if (source.name) {
          parameters.push({ name: source.name, in: "header", required: false, schema: { type: "string" } });
        }
        break;
      case "body":
        if (source.schema) {
          // Converted before `acceptsUndefined` parses: a `z.lazy()` whose definition throws is left half-built by the parse.
          const schema = toSchema(source.schema, "input", context);
          requestBody = { required: !acceptsUndefined(source.schema), content: { "application/json": { schema } } };
        }
        break;
      // `req` (the raw Request) has nothing documentable — no case needed.
    }
  }

  return { parameters, requestBody };
}

function buildResponses(prototype: object, propertyKey: string | symbol, context: SchemaContext): Record<string, OpenApiResponse> {
  const httpCode = getHttpCode(prototype, propertyKey);
  const status = String(httpCode ?? 200);
  const returnsSchema = getReturnsSchema(prototype, propertyKey);

  const responses: Record<string, OpenApiResponse> = {
    [status]: returnsSchema
      ? { description: "Success", content: { "application/json": { schema: toSchema(returnsSchema, "output", context) } } }
      : { description: "Success" },
  };
  // A handler that returns `undefined` is answered with no body: 204 unless `@HttpCode` says otherwise.
  if (returnsSchema && httpCode === undefined && acceptsUndefined(returnsSchema)) {
    responses["204"] = { description: "No content" };
  }
  responses["default"] = {
    description: "Error",
    content: { [PROBLEM_MEDIA_TYPE]: { schema: { $ref: "#/components/schemas/Problem" } } },
  };
  return responses;
}

function buildOperation(controller: Class, route: RouteDefinition, mode: UnrepresentableMode): OpenApiOperation {
  const prototype = controller.prototype as object;
  const operation = getApiOperation(prototype, route.propertyKey);
  const tags = [...getClassApiTags(controller), ...getMethodApiTags(prototype, route.propertyKey)];
  const context: SchemaContext = { where: `${controller.name}.${String(route.propertyKey)}`, mode };
  const { parameters, requestBody } = buildParameters(prototype, route.propertyKey, context);
  const security = getRouteSecurity(controller, route.propertyKey);

  return {
    operationId: operation?.operationId ?? `${controller.name}_${String(route.propertyKey)}`,
    ...(operation?.summary ? { summary: operation.summary } : {}),
    ...(operation?.description ? { description: operation.description } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses: buildResponses(prototype, route.propertyKey, context),
    ...(security ? { security } : {}),
  };
}

/** Every scheme a requirement names must be declared, or a client generator would be handed a dangling reference. */
function assertDeclared(requirements: readonly OpenApiSecurityRequirement[], declared: ReadonlySet<string>, where: string): void {
  for (const requirement of requirements) {
    for (const name of Object.keys(requirement)) {
      if (!declared.has(name)) {
        throw new Error(`[@blixis-io/openapi] ${where} requires security scheme "${name}", which is not in \`securitySchemes\`.`);
      }
    }
  }
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
  const mode = options.onUnrepresentable ?? "open";
  const declared = new Set(Object.keys(options.securitySchemes ?? {}));
  const documentSecurity = options.security ? toRequirements(options.security) : undefined;
  if (documentSecurity) {
    assertDeclared(documentSecurity, declared, "The document's `security`");
  }
  const operationIds = new Map<string, string>();

  for (const controller of app.controllers) {
    const prefix = getControllerPrefix(controller) ?? "";

    for (const route of getRoutes(controller)) {
      const path = buildOpenApiPath(prefix, route.path);
      if (!path) {
        continue;
      }

      const operation = buildOperation(controller, route, mode);
      const where = `${controller.name}.${String(route.propertyKey)}`;
      const owner = operationIds.get(operation.operationId);
      if (owner !== undefined) {
        throw new Error(
          `[@blixis-io/openapi] operationId "${operation.operationId}" is used by both ${owner} and ${where}; give one of them its own with @ApiOperation({ operationId }).`,
        );
      }
      operationIds.set(operation.operationId, where);
      if (operation.security) {
        assertDeclared(operation.security, declared, where);
      }

      paths[path] ??= {};
      paths[path][route.method.toLowerCase()] = operation;
    }
  }

  return {
    openapi: "3.1.0",
    info: { title: options.title, version: options.version, ...(options.description ? { description: options.description } : {}) },
    paths,
    ...(documentSecurity ? { security: documentSecurity } : {}),
    components: {
      schemas: { Problem: PROBLEM_SCHEMA },
      ...(options.securitySchemes ? { securitySchemes: options.securitySchemes } : {}),
    },
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
