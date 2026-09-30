---
title: "@blixis/openapi"
description: Full API reference for the openapi package.
sidebar:
  order: 10
---

Generates an OpenAPI 3.1 document from a running app's real controllers. See [API Documentation](/concepts/api-documentation/) for the concepts.

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
}
```

A plain function returning a plain object — no serving mechanism, no bundled UI. `app` only needs a `controllers` array; a real `HttpApplication` satisfies `ControllerSource` structurally (its own `controllers` getter), but so does any test fixture shaped the same way.

```ts
const doc = generateOpenApiDocument(app, { title: "hello-api", version: "1.0.0" });
```

## `OpenApiDocument` shape

```ts
interface OpenApiDocument {
  openapi: "3.1.0";
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, OpenApiOperation>>; // path -> lowercase HTTP method -> operation
  components: { schemas: { Problem: JsonSchema } };
}

interface OpenApiOperation {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: { required: boolean; content: { "application/json": { schema: JsonSchema } } };
  responses: Record<string, OpenApiResponse>; // status code -> response, plus a "default" entry
}

interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  schema: JsonSchema;
}

interface OpenApiResponse {
  description: string;
  content?: { "application/json": { schema: JsonSchema } };
}

type JsonSchema = Record<string, unknown>; // z.toJSONSchema() output, minus its $schema key
```

## How it reads your routes

Walks `app.controllers` using the same public metadata readers `@blixis/http`'s own `buildRouter` uses internally (`getControllerPrefix`, `getRoutes`, `getParamSources`, `getHttpCode`, `getReturnsSchema`), plus [`getApiOperation`/`getClassApiTags`/`getMethodApiTags`](/reference/blixis-http/#api-documentation-metadata). See [API Documentation](/concepts/api-documentation/#what-gets-documented-and-what-deliberately-doesnt) for exactly what each decorator maps to, and the documented limitations (schema-less `@Query`/`@Body`, wildcard routes, undeclared response shapes).

`:param` path segments become OpenAPI's `{param}` syntax; `*` wildcard routes are excluded from `paths` entirely.
