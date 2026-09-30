---
title: Error Handling
description: HttpException, the built-in exception classes, and the RFC 9457 problem+json response shape.
sidebar:
  order: 8
---

Every error response from a Blixis HTTP app — whether thrown by your code, a failed Zod validation, or an unhandled bug — has the same shape: [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json`.

```json
{
  "type": "about:blank",
  "title": "Not Found",
  "status": 404,
  "detail": "Post 42 not found"
}
```

## `HttpException`

Throw one from a controller method or a guard to produce a specific status:

```ts
import { HttpException } from "@blixis-io/http";

throw new HttpException(422, "Unprocessable", { field: "email" });
```

`status` becomes the response status and the problem body's `status`; `detail` becomes the body's `detail`; the optional third argument is merged directly into the JSON body (used internally for Zod's `issues` array on a `400`). `title` is filled in automatically from a table of standard status-code names, falling back to `"Error"` for a status the table doesn't recognize.

## Named exception classes

For the common cases, use the pre-built subclasses instead of `HttpException` directly:

| Class | Status | Default detail |
|---|---|---|
| `BadRequestException` | 400 | `"Bad Request"` |
| `UnauthorizedException` | 401 | `"Unauthorized"` |
| `ForbiddenException` | 403 | `"Forbidden"` |
| `NotFoundException` | 404 | `"Not Found"` |
| `ConflictException` | 409 | `"Conflict"` |
| `PayloadTooLargeException` | 413 | `"Payload Too Large"` |
| `UnsupportedMediaTypeException` | 415 | `"Unsupported Media Type"` |

Every one takes an optional custom `detail` string:

```ts
throw new NotFoundException(`Post ${id} not found`);
```

`BadRequestException` also accepts the same optional `extra` object as `HttpException`.

See [Writing Custom Exceptions](/guides/writing-custom-exceptions/) for subclassing `HttpException` for your own domain errors.

## What happens automatically

You don't have to throw these yourself for the framework's own failure modes — they're already wired in:

- **A route that doesn't exist** → `404`, `"No route matches this path"`.
- **A route that exists, wrong method** → `405`, with an `Allow` header listing the methods that are registered, and `detail` naming them too.
- **A guard denies** (`canActivate` returns `false`) → `403 Forbidden`.
- **A `@Body`/`@Query`/`@Param` schema fails validation** → `400`, `detail: "Validation failed"`, with an `issues` array (Zod's own issue format) merged into the body.
- **Malformed JSON body** → `400`, `"Invalid JSON body"`.
- **Wrong content-type on a body, or body over the size limit** → `415` / `413` (see [Request Validation](/concepts/request-validation/)).

## Uncaught errors → 500, and the message is hidden

Anything thrown that *isn't* an `HttpException` — a real bug, a database connection failure, a `@Returns` schema mismatch, whatever — becomes a `500` with a generic `detail: "An unexpected error occurred"`. The actual error, including its message and stack, is logged via `console.error` server-side, but **never sent to the client**. This is deliberate: an `HttpException` is an intentional, safe-to-show message; anything else might contain internal details you don't want leaking into a response body — including a `ResponseValidationError`'s Zod issues, which would otherwise reveal your app's internal response shape to whoever's calling it. See [Response Validation](/concepts/response-validation/) for why that one specifically is never an `HttpException`.

## Return values that aren't errors

A controller method's return value becomes the response body too, via the same path — see [Routing & Controllers](/concepts/routing-controllers/) for the full mapping (`undefined` → `204`, a returned `Response` passed through unchanged, everything else → JSON with `200` or a status set via `@HttpCode`). Returning a raw `Response` is also how you redirect or set a non-JSON content type — see the [Cookbook](/examples/cookbook/#returning-a-raw-response-and-setting-a-content-type) for both.

## Next

- A worked example of a custom exception hierarchy: [Writing Custom Exceptions](/guides/writing-custom-exceptions/).
- Every exception class with full signatures: [`@blixis-io/http` reference](/reference/blixis-http/).
