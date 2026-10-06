---
title: API Documentation
description: Generating an OpenAPI 3.1 document from the running app with @blixis-io/openapi.
sidebar:
  order: 16
---

`@blixis-io/openapi` builds an OpenAPI 3.1 document from your app's real controllers — the same `@Controller`/`@Get`/`@Body`/`@Query`/`@Param`/`@Returns` metadata the router itself already reads, plus two optional decorators for human-facing detail. `generateOpenApiDocument` is a plain function returning a plain object; `serveOpenApi(app, "/openapi.json", options)` mounts it in one call (see [Generating API Docs](/framework/guides/generating-api-docs/)). There's no bundled Swagger UI.

## Why OpenAPI 3.1, not 3.0

`zod`'s own `z.toJSONSchema()` produces JSON Schema draft 2020-12 — which is exactly OpenAPI 3.1's schema dialect. OpenAPI 3.0 uses an older, lossier JSON Schema subset that would need a translation layer; 3.1 needs none. This is a technical fact, not a preference — verified directly (`z.toJSONSchema(schema)` output is used as-is for every `schema` field in the generated document).

## Generating the document

```ts
import { generateOpenApiDocument } from "@blixis-io/openapi";

const app = await createHttpApplication(AppModule);

const doc = generateOpenApiDocument(app, {
  title: "hello-api",
  version: "1.0.0",
  description: "Optional",
});
```

`generateOpenApiDocument` only ever reads `app.controllers` — any object shaped `{ controllers: readonly Class[] }` works, not just a real `HttpApplication`, which is what makes it cheap to unit test without booting a real app.

## Mounting it

```ts
import { serveOpenApi } from "@blixis-io/openapi";

const app = await createHttpApplication(AppModule);
serveOpenApi(app, "/openapi.json", { title: "my-api", version: "1.0.0" });
```

`serveOpenApi` mounts a public `GET` route ahead of the router (via `app.mount()`) and builds the document on first request. The route bypasses guards and interceptors. To protect the document, generate it inside a normal guarded controller instead; that needs a reference to the finished app, which a controller can't get at construction time, so hold it in a small provider set right after `createHttpApplication()` resolves. See the [guide on mounting it](/framework/guides/generating-api-docs/).

## Enriching a route with `@ApiOperation` and `@ApiTags`

```ts
@ApiTags("posts")
@Controller("posts")
class PostsController {
  @Get()
  @ApiOperation({ summary: "List every post" })
  list() { /* ... */ }

  @ApiTags("admin")
  @Delete(":id")
  @ApiOperation({ summary: "Delete a post", description: "Requires the x-api-key header." })
  remove(@Param("id") id: string) { /* ... */ }
}
```

Both are entirely optional — a route with neither still gets a valid, unique `operationId` (derived as `${ControllerName}_${methodName}`), just no summary/description/tags. `@ApiTags` works like `@UseGuards`/`@UseInterceptors` (class position or method position), except class-level and method-level tags **concatenate** — `remove` above ends up tagged `["posts", "admin"]`, not just `["admin"]`.

## What gets documented, and what deliberately doesn't

- **Path params** (`@Param`) → required path parameters, typed from the schema if given, `{type: "string"}` otherwise.
- **Query params** (`@Query`) → one parameter per key of the schema's shape, whatever wrapped the object (`.refine()`, `.transform()`, `.strict()`). A key is `required` only when it has neither a default nor `.optional()`. There's nothing to enumerate for a schema-less `@Query()` or a schema that isn't an object (a `z.record()`, say), so nothing is documented for those.
- **Headers** (`@Headers(name)`) → one parameter, only when `name` is given — `@Headers()` (all headers) has nothing specific to document either.
- **Body** (`@Body(schema)`) → the JSON request body, only with a schema. It is `required` unless the schema accepts a missing value (`.optional()`, `z.unknown()`), because the handler reads an empty body as `undefined`. `additionalProperties: false` appears only when the schema is `.strict()`: a plain `z.object()` accepts extra keys and strips them.
- **Responses**: the `@Returns` schema (if present) at `@HttpCode`'s status (or `200`). When the `@Returns` schema accepts `undefined` (and no `@HttpCode` fixes the status), `204` is documented next to it, since that is what the handler answers for `undefined`. Without `@Returns`, the status is still documented but with no schema — the generator can't statically know whether a handler returns `undefined` without one, so give routes that return nothing an explicit `@HttpCode(204)` if you want the document to say so accurately.
- Every operation also gets a `default` response referencing one shared `components.schemas.Problem` object — under the `application/problem+json` media type, matching what the framework really sends — rather than guessing which specific 4xx/5xx codes apply to which route.
- **Wildcard (`*`) routes are excluded entirely** — OpenAPI has no path construct for them.

## Which side of a schema is documented

A Zod schema has two sides: what goes in and what comes out. The document describes the side a reader needs:

| Where | Side | Effect |
| --- | --- | --- |
| Request body, query, path params | **input**: what the client sends | a field with `.default()` is **not** required; a `.transform()` is documented by its input type |
| `@Returns` response | **output**: what the server returns | the default has been applied, so the field **is** required |

```ts
const Create = z.object({ title: z.string(), tags: z.array(z.string()).default([]) });
// request body: required: ["title"]            (the client may omit tags)
// @Returns(Create) response: required: ["title", "tags"]
```

## Schemas JSON Schema can't express

The document is always generated; one awkward schema never takes it down. (Before, a `z.date()` or any `.transform()` made `serveOpenApi` answer `500` and `generateOpenApiDocument` throw.)

- A `z.date()` is documented as `{ type: "string", format: "date-time" }`, which is what JSON serialization makes of it.
- A type with no JSON Schema equivalent (the output of a `.transform()`, a `z.custom()`) is documented as an open schema, `{}`.
- A schema that can't be converted at all becomes `{ description: "Schema could not be converted to JSON Schema: <reason>" }`, so the reason is visible in the document and every other operation is unaffected.

## Documenting authentication

The document says how to authenticate only if you tell it. Declare the schemes once, then mark routes:

```ts
const doc = generateOpenApiDocument(app, {
  title: "my-api",
  version: "1.0.0",
  securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
  security: ["bearerAuth"], // every operation, unless a route says otherwise
});
```

```ts
@ApiSecurity(false) // public: overrides the document-wide requirement
@Get("health")
health() { /* ... */ }

@ApiSecurity({ oauth: ["admin"] }) // a scheme with scopes
@Delete(":id")
remove() { /* ... */ }
```

`@ApiSecurity` works at class or method position (the method wins). Each argument is one alternative, a scheme name or `{ name: scopes }`; `false` means public. It only changes the document: **it enforces nothing, guards do**, so keep it in step with your `@Public()` and roles by hand. A name that isn't declared in `securitySchemes` makes generation throw, naming the route, so a client generator never gets a dangling reference.

## Failing the build on an open schema

`onUnrepresentable` decides what happens when a schema can't be expressed (see above): `"open"` (default) documents it as open silently; `"warn"` also logs the route and the kind of schema; `"throw"` fails generation with the same message. `z.any()`, `z.unknown()` and `z.date()` are never flagged: they are open or mapped on purpose. A CI step that generates the document with `"throw"` keeps a silently open schema from shipping.

```ts
generateOpenApiDocument(app, { title: "my-api", version: "1.0.0", onUnrepresentable: "throw" });
```

## Unique operation ids

Two routes with the same `operationId` (typically two controller classes with the same name, since the default is `${ControllerName}_${methodName}`) make generation throw, naming both. Give one an explicit `@ApiOperation({ operationId })`.

## Next

- Every exported symbol: [`@blixis-io/openapi` reference](/framework/reference/blixis-openapi/).
- Mounting a route for it, step by step: [guide](/framework/guides/generating-api-docs/).
- The decorators this builds on: [Routing & Controllers](/framework/concepts/routing-controllers/), [Response Validation](/framework/concepts/response-validation/).
