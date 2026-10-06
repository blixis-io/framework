---
title: Logging requests and errors
description: onError, the requestId() and accessLog() middleware, and wiring them to @blixis-io/logging.
sidebar:
  order: 8.5
---

Three small pieces in `@blixis-io/http` give you a request log and a way to connect a failure to the request that caused it. None is on by default.

## `onError`: unexpected errors

An error a controller, guard, interceptor or middleware throws that is **not** an `HttpException` is a bug, not an answer. The client gets a generic `500` (the message is never sent), and the error goes to `onError`:

```ts
import { createLogger, consoleTransport } from "@blixis-io/logging";

const logger = createLogger({ transports: [consoleTransport()] });

const app = await createHttpApplication(AppModule, {
  onError: ({ error, request, route, requestId }) => {
    logger.error("request failed", {
      err: error,
      method: request?.method,
      path: request ? new URL(request.url).pathname : undefined,
      handler: route ? `${route.controller.name}.${String(route.handler)}` : undefined,
      requestId,
    });
  },
});
```

The report carries the `request`, the matched `route` (not set for a middleware, a mounted handler or a router refusal) and the `requestId`. `phase` says what failed: `"request"`, `"boot"` (the application failed to start under `createFetchHandler`) or `"shutdown"` (a shutdown hook failed while rolling back a failed boot).

- An `HttpException` is **not** reported: a `404` or `401` thrown on purpose is an answer. A `504` from `requestTimeout` isn't either.
- Without `onError`, the error is written with `console.error`, the error first, as before.
- `onError` can't make things worse: if it throws, the client still gets its `500` and both failures are written to `console.error`.
- Log only what you need from `request`. Headers and bodies hold tokens and personal data; the path without the query string is usually enough.

## `requestId()`: one id per request

```ts
import { accessLog, requestId } from "@blixis-io/http";

const app = await createHttpApplication(AppModule, {
  middleware: [requestId(), accessLog({ log: (entry) => logger.info("request", { ...entry }) })],
  onError: /* as above */,
});
```

`requestId()` keeps the client's `x-request-id` if it is a short token (letters, digits and `._:-`, up to 128 characters) and makes a UUID otherwise, stores it in the [`RequestContext`](/framework/concepts/request-context/), and sets it on the response, including on a `404` or a guard's `403`. Read it anywhere with `currentRequestId()`. Options: `header` (default `x-request-id`), `generate`, and `trustIncoming: false` to ignore ids clients send.

Put it **first** in `middleware`, so everything after it, and every error report, has the id.

## `accessLog()`: one line per request

Each entry has `method`, `path`, `status`, `durationMs` and, when `requestId()` ran first, `requestId`. It covers every request, including the ones that never reach a route. It leaves out the query string, headers and bodies on purpose.

`durationMs` is the time until the response was **created**, not until its last byte: a streamed body is still being produced. A throw from your `log` function is caught; logging never fails a request.

## Connecting a failure to its log line

With the setup above, one request id appears in the access-log entry and in the `onError` report for the same failing request, and in the `x-request-id` header the client got back, so a user can quote it in a bug report.

## Not covered yet

Metrics and tracing integrations, and a readiness endpoint that reflects dependencies and shutdown (`@blixis-io/health`, next).

Two more places take a hook of their own: a shutdown hook that fails while a failed boot is rolled back reaches `onError` with `phase: "shutdown"` (for `createHttpApplication`, and as `onRollbackError` on `createApplication` from `@blixis-io/core`), and a failing event listener goes to `onHandlerError` on `EventsModule.forRoot()` from `@blixis-io/events`:

```ts
EventsModule.forRoot({ onHandlerError: ({ type, error }) => logger.error("event handler failed", { type, err: error }) });
```
