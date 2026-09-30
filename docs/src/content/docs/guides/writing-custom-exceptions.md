---
title: Writing Custom Exceptions
description: Subclass HttpException for domain-specific errors with a consistent shape.
sidebar:
  order: 4
---

The [built-in exception classes](/framework/concepts/error-handling/#named-exception-classes) cover the standard HTTP statuses. For a domain-specific error — a business rule violation that isn't naturally "not found" or "bad request" — subclass `HttpException` directly, the same way the built-ins do:

```ts title="src/posts/post-already-published.exception.ts"
import { HttpException } from "@blixis-io/http";

export class PostAlreadyPublishedException extends HttpException {
  constructor(postId: string) {
    super(409, `Post ${postId} is already published`, { postId });
    this.name = "PostAlreadyPublishedException";
  }
}
```

Setting `this.name` isn't cosmetic — it's what shows up in stack traces and in any logging/monitoring that inspects `error.name`, and it's how you'd distinguish this from a generic `ConflictException` in a `catch` block if you ever needed to.

Use it exactly like a built-in:

```ts
@Post(":id/publish")
publish(@Param("id") id: string) {
  const post = this.posts.get(id);
  if (post.published) {
    throw new PostAlreadyPublishedException(id);
  }
  return this.posts.publish(id);
}
```

The response is the same `application/problem+json` shape as everything else, with your extra fields merged in:

```json
{
  "type": "about:blank",
  "title": "Conflict",
  "status": 409,
  "detail": "Post 42 is already published",
  "postId": "42"
}
```

## A small hierarchy for a domain

If you have several related errors, a shared base class keeps the status/shape decisions in one place:

```ts
abstract class DomainException extends HttpException {}

export class PostNotFoundException extends DomainException {
  constructor(id: string) {
    super(404, `Post ${id} not found`, { id });
    this.name = "PostNotFoundException";
  }
}

export class PostAlreadyPublishedException extends DomainException {
  constructor(id: string) {
    super(409, `Post ${id} is already published`, { id });
    this.name = "PostAlreadyPublishedException";
  }
}
```

## What you don't need to do

You don't register exception classes anywhere, and you don't need a try/catch in the controller method itself — any `HttpException` thrown from a controller method or a guard is caught by the framework and turned into the matching response automatically. See [Error Handling](/framework/concepts/error-handling/) for exactly how that mapping works, and why an error that *isn't* an `HttpException` becomes a generic `500` instead.
