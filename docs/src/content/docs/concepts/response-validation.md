---
title: Response Validation
description: "@Returns, enforcing a route's response shape against a Zod schema."
sidebar:
  order: 6.5
---

`@Returns(schema)` declares what a route's response body must look like, and enforces it — the handler's return value is validated against `schema` right before it's serialized, on every request, not just in tests.

## `@Returns`

```ts
import { Controller, Get, Returns } from "@blixis-io/http";
import { z } from "zod";

const PostSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
});

@Controller("posts")
class PostsController {
  @Get(":id")
  @Returns(PostSchema)
  get(@Param("id") id: string) {
    return this.posts.get(id); // validated against PostSchema before it's sent
  }
}
```

Same convention as the request side: `export const PostSchema = z.object({...})` and `export type Post = z.infer<typeof PostSchema>` — one schema is both the runtime check and the type, so implementation and contract can't quietly drift apart. A list endpoint uses `z.array(PostSchema)`, same as any other Zod schema.

## A mismatch is a 500, not a 400

This is the one thing that makes `@Returns` different from `@Body`/`@Query`/`@Param`: a failing *request* schema is the client's fault (`400`, with the Zod issues attached so they can fix their request). A failing *response* schema is never the client's fault — it means the handler's implementation drifted from its own declared contract, which is a server bug. So it becomes a generic `500`, logged internally with the full Zod issues, but **never exposing the mismatch (or the app's internal shape) to the client**:

```json
{
  "type": "about:blank",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "An unexpected error occurred"
}
```

The real diagnostic — which field, what was expected — goes to the server log via the same path any other unexpected error does; see [Error Handling](/framework/concepts/error-handling/) for why internal errors are always hidden from the client this way.

## What gets sent is the parsed value

Like `@Body`/`@Query`/`@Param`, validating also means *parsing* — if your schema coerces or defaults a field, the value actually sent to the client is the schema's output, not your handler's raw return value:

```ts
const ItemSchema = z.object({ id: z.string(), count: z.coerce.number() });

@Get()
@Returns(ItemSchema)
weirdButFine() {
  return { id: "1", count: "3" }; // count is a string here...
  // ...but the client receives { "id": "1", "count": 3 } — a number
}
```

## The schema is also an output filter

`z.object` strips keys it doesn't declare, and what's sent is the parsed value. So `@Returns` doubles as an allow-list: a handler that returns a whole database row, `passwordHash` included, sends only the fields the schema names.

```ts
const UserSchema = z.object({ id: z.string(), name: z.string() });

@Get(":id")
@Returns(UserSchema)
get() {
  return this.users.find(id); // { id, name, passwordHash } -> client receives { id, name }
}
```

Keep this in mind before turning validation off (next section).

## What validation costs, and turning it off

Validation is on for every `@Returns` route by default. On a 6-field object it costs about as much as the `JSON.stringify` that follows: roughly 0.2 ms for 1 000 items (550 KiB) and 1.5 ms for 10 000 (5.5 MB). Schemas without async refinements are parsed synchronously, which is 3-4x faster than Zod's async path; a schema with an async refinement falls back to the async path automatically.

If a hot route's payload makes that matter, opt out per route, or app-wide:

```ts
@Get()
@Returns(PostSchema, { validate: false })   // this route only
list() { /* ... */ }

await createHttpApplication(AppModule, { responseValidation: "never" }); // every route
```

A route's `validate` wins over the app-wide setting in both directions, so `{ validate: true }` keeps one route checked under `"never"`. What changes when validation is skipped:

- The handler's value is sent as-is: **no coercion, no defaults, and no stripping of unknown keys.** An object carrying extra fields (the `passwordHash` above) is sent whole.
- A value that doesn't match the schema is no longer a `500`; it reaches the client.
- The OpenAPI document is unaffected: the schema still describes the route.

There's no built-in `"development"` mode, because it would depend on guessing your environment. To validate everywhere except production, say so explicitly:

```ts
await createHttpApplication(AppModule, {
  responseValidation: process.env["NODE_ENV"] === "production" ? "never" : "always",
});
```

If you turn it off in production, keep it on in tests and CI so a contract drift is still caught before release.

## Two escape hatches, unvalidated on purpose

- **A route that returns `undefined`** (mapped to `204 No Content`) skips validation entirely, even with `@Returns` declared — there's no body to check, and `204` is already the established "nothing to validate" convention (see [Routing & Controllers](/framework/concepts/routing-controllers/)).
- **A route that returns a raw `Response`** also skips validation — returning a `Response` directly is already documented as a deliberate opt-out of the normal JSON pipeline (see the [Cookbook](/framework/examples/cookbook/#returning-a-raw-response-and-setting-a-content-type)), and a schema was never meant to describe it.

## Next

- Every exported symbol: [`@blixis-io/http` reference](/framework/reference/blixis-http/#returns-response-validation).
- The request-side equivalent: [Request Validation](/framework/concepts/request-validation/).
- See it applied to every route on a real controller: the [hello-api walkthrough](/framework/examples/hello-api-walkthrough/).
