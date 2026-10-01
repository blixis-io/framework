---
title: Configuring Body Size Limits
description: Change the default 1 MiB request body limit, globally or you'll want to know where it applies.
sidebar:
  order: 5
---

By default, a request body over **1 MiB** is rejected with `413 Payload Too Large` before your controller method runs — see [Request Validation](/framework/concepts/request-validation/#body-parsing-rules) for exactly when this check happens.

## Changing the limit

Pass `bodyLimit` (in bytes) to `createHttpApplication`:

```ts
import { createHttpApplication } from "@blixis-io/http";

const app = await createHttpApplication(AppModule, {
  bodyLimit: 5 * 1024 * 1024, // 5 MiB
});
```

The same option works with `@blixis-io/testing`'s `Test.createModule(...).compile(options)`:

```ts
const app = await Test.createModule({ imports: [PostsModule] }).compile({
  bodyLimit: 100, // deliberately tiny, to test the 413 path itself
});
```

## Where it applies

Only to routes with a `@Body()` parameter — a route that never reads the body never triggers either the `Content-Length` pre-check or the actual byte-length check, regardless of the limit. There's currently no per-route override; it's one limit for the whole application. If different routes genuinely need different limits (a file upload endpoint alongside small JSON APIs), that's a gap worth knowing about now rather than discovering at the worst time — the current framework doesn't have a built-in answer for it.

## Why it's checked twice

A declared `Content-Length` header is checked first, cheaply, before the body is even read — a client that's honest about a too-large body gets rejected immediately. The body is then read as a stream and cancelled the moment it crosses the limit, since `Content-Length` is just a claim the client makes, not a guarantee. A chunked body with no `Content-Length` is never buffered whole before being rejected.
