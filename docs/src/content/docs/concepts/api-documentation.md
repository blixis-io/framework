---
title: API Documentation
description: Generating an OpenAPI 3.1 document from the running app with @blixis/openapi.
sidebar:
  order: 16
---

`@blixis/openapi` builds an OpenAPI 3.1 document from your app's real controllers — the same `@Controller`/`@Get`/`@Body`/`@Query`/`@Param`/`@Returns` metadata the router itself already reads, plus two optional decorators for human-facing detail. It's a plain function returning a plain object; there's no auto-mounted route and no bundled Swagger UI — you wire it in with the same primitives every other route uses.

## Why OpenAPI 3.1, not 3.0

`zod`'s own `z.toJSONSchema()` produces JSON Schema draft 2020-12 — which is exactly OpenAPI 3.1's schema dialect. OpenAPI 3.0 uses an older, lossier JSON Schema subset that would need a translation layer; 3.1 needs none. This is a technical fact, not a preference — verified directly (`z.toJSONSchema(schema)` output is used as-is for every `schema` field in the generated document).

## Generating the document

```ts
import { generateOpenApiDocument } from "@blixis/openapi";

const app = await createHttpApplication(AppModule);

const doc = generateOpenApiDocument(app, {
  title: "hello-api",
  version: "1.0.0",
  description: "Optional",
});
```

`generateOpenApiDocument` only ever reads `app.controllers` — any object shaped `{ controllers: readonly Class[] }` works, not just a real `HttpApplication`, which is what makes it cheap to unit test without booting a real app.

## Mounting it

There's a real chicken-and-egg wrinkle here: the document needs `app.controllers`, but `app` doesn't exist until *after* the whole module graph — including whatever controller serves the document — has already been built. The [hello-api walkthrough](/examples/hello-api-walkthrough/) shows the fix: a small DI-registered `AppRef` provider, set once right after `createHttpApplication()` resolves, read lazily at request time (by which point the app is always fully booted):

```ts
@Injectable()
class AppRef {
  current: HttpApplication | undefined;
}

@Controller()
class DocsController {
  constructor(private readonly appRef: AppRef) {}

  @Get("openapi.json")
  spec() {
    if (!this.appRef.current) throw new Error("app not booted yet");
    return generateOpenApiDocument(this.appRef.current, { title: "my-api", version: "1.0.0" });
  }
}
```

```ts
// main.ts
const app = await createHttpApplication(AppModule);
app.get(AppRef).current = app;
```

This is the one place in this framework's own conventions where a mutable provider is the right tool — everywhere else, prefer `RequestContext` or a constructor-injected value. See the full worked example and the [guide on mounting it](/guides/generating-api-docs/).

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
- **Query params** (`@Query`) → one parameter per key, **only when the schema is a `ZodObject`** — there's nothing to enumerate for a schema-less `@Query()` or a non-object schema, so nothing is documented for those. Give your query schemas a real shape; it's good practice regardless.
- **Headers** (`@Headers(name)`) → one parameter, only when `name` is given — `@Headers()` (all headers) has nothing specific to document either.
- **Body** (`@Body(schema)`) → the JSON request body, only with a schema.
- **Responses**: the `@Returns` schema (if present) at `@HttpCode`'s status (or `200`). Without `@Returns`, the status is still documented but with no schema — the generator can't statically know whether a handler returns `undefined` (→ `204` at runtime) without one, so give routes that return nothing an explicit `@HttpCode(204)` if you want the document to say so accurately.
- Every operation also gets a `default` response referencing one shared `components.schemas.Problem` object — matching this framework's actual `application/problem+json` error shape — rather than guessing which specific 4xx/5xx codes apply to which route.
- **Wildcard (`*`) routes are excluded entirely** — OpenAPI has no path construct for them.

## Next

- Every exported symbol: [`@blixis/openapi` reference](/reference/blixis-openapi/).
- Mounting a route for it, step by step: [guide](/guides/generating-api-docs/).
- The decorators this builds on: [Routing & Controllers](/concepts/routing-controllers/), [Response Validation](/concepts/response-validation/).
