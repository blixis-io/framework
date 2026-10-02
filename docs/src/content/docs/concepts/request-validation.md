---
title: Request Validation
description: "@Body, @Query, @Param, @Headers, @Req, and Zod schema validation."
sidebar:
  order: 6
---

Every controller method parameter that needs data from the request is built by a parameter decorator. Each one has an optional [Zod](https://zod.dev) schema; give one and the decorator returns the *parsed, validated, type-coerced* value, not the raw input.

## The five decorators

```ts
import { Body, Headers, Param, Query, Req } from "@blixis-io/http";

@Post(":id/comments")
addComment(
  @Param("id") postId: string,
  @Body(CreateCommentSchema) body: CreateCommentInput,
  @Query() query: unknown,
  @Headers("authorization") auth: string | null,
  @Req() req: Request,
) {
  /* ... */
}
```

- **`@Body(schema?)`** — the parsed JSON request body.
- **`@Query(schema?)`** — the parsed query string, as a plain object.
- **`@Param(name, schema?)`** — one named route param (see [Routing & Controllers](/framework/concepts/routing-controllers/) for how `:name` segments are captured).
- **`@Headers(name?)`** — one header value by name, or (with no argument) all headers as a plain object.
- **`@Req()`** — the raw Web-standard `Request`, no parsing at all.

None of these are limited to a single use per method, and they can appear in any order/position — each is resolved independently and placed at its own parameter index.

## With a schema: validated and coerced

```ts
const CreatePostSchema = z.object({
  title: z.string().min(1),
  body: z.string().default(""),
});
type CreatePostInput = z.infer<typeof CreatePostSchema>;

@Post()
create(@Body(CreatePostSchema) input: CreatePostInput) {
  // input.title is guaranteed a non-empty string, input.body defaults to ""
}
```

The convention is exactly that pair: `export const XSchema = z.object({...})` and `export type XInput = z.infer<typeof XSchema>` — the schema *is* the runtime validator and the source of the type, so they can't drift apart. This is also why route params support schemas: `@Param("id", z.coerce.number())` turns the route param — always a raw string, since it came out of a URL — into a `number` before your handler ever sees it.

If validation fails, the handler never runs. The request short-circuits to a `400` with the Zod issues attached (see [Error Handling](/framework/concepts/error-handling/)):

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Validation failed",
  "issues": [
    { "code": "invalid_type", "path": ["title"], "message": "Invalid input: expected string, received undefined" }
  ]
}
```

## Without a schema: raw values

Every decorator works with no schema at all — you get the unvalidated value as-is: `@Body()` gives the parsed JSON (`unknown`), `@Query()` gives the parsed search params object, `@Param("id")` gives the raw string. Useful for a quick prototype route or a handler that validates by hand; for anything that stays in the codebase, prefer a schema.

## Body parsing rules

A request body is only read when a route actually has a `@Body()` parameter. When it does:

- **Content-Type must be `application/json`** (case-insensitive prefix match) — anything else is `415 Unsupported Media Type`, checked *before* the body is read at all.
- **Size is checked twice** — first cheaply, against a declared `Content-Length` header, then against the actual decoded byte length — either one over the configured limit (1 MiB by default) gives `413 Payload Too Large`.
- **No body sent, or an empty body** — `undefined`, not an error (so a schema requiring the field will correctly reject it with a normal `400`, rather than the framework guessing).
- **Malformed JSON** — `400 Bad Request`, distinct from a schema validation failure.
- **Body cut off** — if the client disconnects or closes its side before the whole body has arrived, reading it fails with `400 Bad Request` (`"Request body was not fully received"`), not an internal `500`, so it isn't logged as a server error.

The body limit is configurable — see [Configuring Body Size Limits](/framework/guides/configuring-body-size-limits/).

## Next

- The same schema-validation idea, applied to what a route sends back: [Response Validation](/framework/concepts/response-validation/).
- What happens when a route needs to reject a request before validation even runs: [Guards & Authorization](/framework/concepts/guards-and-authorization/).
- The exact shape of every error response: [Error Handling](/framework/concepts/error-handling/).
- A worked example: [Validating Request Bodies with Zod](/framework/guides/validating-request-bodies/).
