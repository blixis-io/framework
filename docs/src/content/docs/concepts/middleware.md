---
title: Middleware
description: The middleware option, code that runs around every request, including the ones the router refuses.
sidebar:
  order: 7.8
---

A middleware is a function that wraps the whole application: it gets the `Request` and a `next()` that runs the rest, and returns the `Response`. Use it for things that apply to every request: access logs, response headers, CORS, rate limits, request ids.

```ts
import { createHttpApplication, type Middleware } from "@blixis-io/http";

const accessLog: Middleware = async (request, next) => {
  const started = performance.now();
  const response = await next();
  console.log(request.method, new URL(request.url).pathname, response.status, `${Math.round(performance.now() - started)}ms`);
  return response;
};

const app = await createHttpApplication(AppModule, { middleware: [accessLog] });
```

The same option works on `createFetchHandler`. There is no `app.use()`: the chain is the array, so the order is visible in one place.

## Middleware or interceptor?

| | Middleware | [Interceptor](/framework/concepts/interceptors/) |
| --- | --- | --- |
| Applies to | every request | one controller or route |
| Sees `404`, `405`, malformed path, mounted routes | yes | no |
| Sees a guard's `403` | yes | no, runs after guards |
| Dependency injection | no, a plain function | yes, a class |
| Knows the matched route | no | yes, `ExecutionContext` |

## Order

The first entry in the array is the outermost. For `[a, b]`, a request runs `a` before `b` before the application, and the response comes back through `b` then `a`.

```text
a > b > timeout > routing > guards > interceptors > handler
```

The chain sits **outside** `requestTimeout`: the deadline covers the application, so a middleware that never calls `next()` or never returns is not timed out for you. A request that times out is a `504` response that the middleware sees like any other.

## What a middleware does

- **Call `next()` and return its response**, changed or not. To add headers, use `withResponseHeaders(response, { name: value })` rather than `response.headers.set()`: some responses have immutable headers (`Response.redirect()`, one returned by `fetch()`), and `set()` throws on those. `next()` can be called once; a second call is an error.
- **Answer itself**, without calling `next()`: a `429` from a rate limiter, a preflight `204` from CORS. Nothing downstream runs.
- **Hand on a changed request**: `next(new Request(request, { headers }))`. Without an argument the current request goes on.
- **Throw.** An `HttpException` (`throw new UnauthorizedException("no token")`) answers with that exception's problem+json. Any other error is logged and answers a generic `500`, with the message kept from the client. A middleware that returns something other than a `Response` is also a `500`.

A failure inside the application (a controller error, a mounted handler that throws) reaches a middleware as a `500` **response**, not as a rejection from `next()`, so every middleware sees failures the same way.

## Request context

The chain runs inside a [`RequestContext`](/framework/concepts/request-context/) scope, and the guards and the controller then use that same scope. A value a middleware sets (a request id, say) is the one a guard or service reads, and no other request sees it. A request made from inside a handler (`app.handle()` for a sub-request) gets a scope of its own.

## What a middleware sees of the response

The `Response` as it was created, not the end of its body. A streamed body is still being produced when `next()` resolves, so a middleware can set headers and read the status, but a latency it measures is the time to the response head, not to the last byte. Don't read the body in a middleware unless you intend to replace it: a body can only be read once.

## What it doesn't do

It doesn't know which route matched, doesn't take part in dependency injection, and ships no CORS, security-header, rate-limit or logging middleware of its own. Those are small functions you write, or that a package provides, using this option.
