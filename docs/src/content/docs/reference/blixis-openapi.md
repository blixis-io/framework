---
title: "@blixis-io/openapi"
description: Full API reference for the openapi package.
sidebar:
  order: 10
---

Generates an OpenAPI 3.1 document from a running app's real controllers. See [API Documentation](/framework/concepts/api-documentation/) for the concepts.

## `generateOpenApiDocument`

```ts
function generateOpenApiDocument(app: ControllerSource, options: OpenApiDocumentOptions): OpenApiDocument;

interface ControllerSource {
  readonly controllers: readonly Class[];
}

interface OpenApiDocumentOptions {
  title: string;
  version: string;
  description?: string;
  securitySchemes?: Record<string, OpenApiSecurityScheme>; // declared under components.securitySchemes
  security?: (string | OpenApiSecurityRequirement)[]; // applies to every operation unless @ApiSecurity overrides it
  onUnrepresentable?: UnrepresentableMode; // "open" | "warn" | "throw", default "open"
}
```

A plain function returning a plain object — no serving mechanism, no bundled UI. `app` only needs a `controllers` array; a real `HttpApplication` satisfies `ControllerSource` structurally (its own `controllers` getter), but so does any test fixture shaped the same way.

```ts
const doc = generateOpenApiDocument(app, { title: "hello-api", version: "1.0.0" });
```

## `serveOpenApi`

```ts
function serveOpenApi(app: MountableApp, path: string, options: OpenApiDocumentOptions): void;
```

Mounts `GET path` on an `HttpApplication` (via `app.mount()`), serving the generated document as JSON — built on first request, then cached. The route is public: mounted routes bypass guards and interceptors.

Throws when a security requirement names a scheme missing from `securitySchemes`, or when two operations share an `operationId`; with `onUnrepresentable: "throw"` it also throws for a schema JSON Schema can't express. With the default it never throws for a schema.

## `ApiSecurity`

```ts
function ApiSecurity(...requirements: [false] | (string | Record<string, string[]>)[]): ClassDecorator & MethodDecorator;
```

Marks a controller or a route with the security schemes it needs, in the generated document only. `false` marks it public. See [Documenting authentication](/framework/concepts/api-documentation/#documenting-authentication).

## `OpenApiDocument` shape

```ts
interface OpenApiDocument {
  openapi: "3.1.0";
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, OpenApiOperation>>; // path -> lowercase HTTP method -> operation
  security?: OpenApiSecurityRequirement[]; // only when the options set it
  components: { schemas: { Problem: JsonSchema }; securitySchemes?: Record<string, OpenApiSecurityScheme> };
}

interface OpenApiOperation {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: { required: boolean; content: { "application/json": { schema: JsonSchema } } };
  responses: Record<string, OpenApiResponse>; // status code -> response, plus a "default" entry (application/problem+json)
  security?: OpenApiSecurityRequirement[]; // only when @ApiSecurity is used; [] = public
}

interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  schema: JsonSchema;
}

interface OpenApiResponse {
  description: string;
  content?: Record<string, { schema: JsonSchema }>; // media type -> schema
}

type OpenApiSecurityScheme = { type: string } & Record<string, unknown>; // passed through as given
type OpenApiSecurityRequirement = Record<string, string[]>; // scheme name -> scopes

type JsonSchema = Record<string, unknown>; // z.toJSONSchema() output, minus its $schema key; never throws (see below)
```

## How it reads your routes

Walks `app.controllers` using the same public metadata readers `@blixis-io/http`'s own `buildRouter` uses internally (`getControllerPrefix`, `getRoutes`, `getParamSources`, `getHttpCode`, `getReturnsSchema`), plus [`getApiOperation`/`getClassApiTags`/`getMethodApiTags`](/framework/reference/blixis-http/#api-documentation-metadata). See [API Documentation](/framework/concepts/api-documentation/#what-gets-documented-and-what-deliberately-doesnt) for exactly what each decorator maps to, and the documented limitations (schema-less `@Query`/`@Body`, wildcard routes, undeclared response shapes).

`:param` path segments become OpenAPI's `{param}` syntax; `*` wildcard routes are excluded from `paths` entirely.

Requests are described by a schema's **input** side and responses by its **output** side; a `z.date()` is a `date-time` string, other unrepresentable types are open schemas, and a schema that can't be converted becomes an open schema whose `description` says why. See [API Documentation](/framework/concepts/api-documentation/#which-side-of-a-schema-is-documented).
