---
title: The Request Path
description: What happens to one HTTP request, in order, from the socket to the bytes written back, and which status code each stage can produce.
sidebar:
  order: 4.5
---

This page follows a single request through `@blixis-io/http` in the order things happen. The other concept pages each cover one stage in depth; this one shows how they fit together, so you can answer "where does this get checked?" and "why did I get that status?".

```text
socket > Request > timeout > route match > RequestContext scope > Response > socket

inside the scope: guards > interceptors > params + body > handler
exceptions thrown anywhere inside the scope become responses
```

## 1. The socket becomes a `Request`

`listen()` runs on Node's HTTP server and converts each incoming message to a Web-standard `Request`. `createFetchHandler` skips this stage: the platform already hands you a `Request`.

- Node's parser rejects a malformed request before any of your code runs: a bad request line, oversized headers (`431`), or a bad or conflicting `Content-Length` (`400`). See [Running in Production](/framework/guides/running-in-production/).
- A body is only attached when the request says it carries one (`Content-Length` above 0, or `Transfer-Encoding`). It stays an unread stream; nothing is buffered yet.
- `request.signal` aborts if the client disconnects.

## 2. The timeout, if you set one

With `requestTimeout`, `request.signal` also aborts after that many milliseconds, so a handler that passes the signal on to `fetch` or a database call stops when the request does.

## 3. Route match

The path is split into segments and each one is percent-decoded once (`hello%20world` becomes `hello world`; see [how a request is matched](/framework/concepts/routing-controllers/#percent-encoding)). The decoded path and the method then pick one route.

| Result | Status |
| --- | --- |
| A broken `%` escape in the path (`/posts/100%`) | `400` |
| No route for this path | `404` |
| Path matches, method doesn't | `405` with an `Allow` header |

All three are answered right here. **No guard, interceptor or handler runs**, and no `RequestContext` scope is opened.

## 4. A fresh `RequestContext` scope

Everything from here to the response runs inside one [`RequestContext`](/framework/concepts/request-context/) scope. Values set in a guard are visible to interceptors, the handler and any service they call, and to no other request.

## 5. Guards

Guards run **one after another and stop at the first denial**, in this order: [global guards](/framework/concepts/guards-and-authorization/), then the controller's `@UseGuards`, then the route's. A guard that returns `false` gives `403`; one that throws gives whatever it threw (`401` from `UnauthorizedException`, for example).

Guards run **before the body is read and before parameters are resolved**. A request that fails authorization costs a header check, not a body upload and a schema parse.

## 6. Interceptors

[Interceptors](/framework/concepts/interceptors/) wrap everything after this point: the controller's outermost, the route's innermost. Each one calls `next()` to continue and can inspect, replace or time the `Response` on the way back. An interceptor can also skip `next()` and answer on its own, in which case the handler never runs.

## 7. Parameters and body

The innermost step builds the handler's arguments from `@Param`, `@Query`, `@Headers`, `@Req` and `@Body`. They resolve together, and a [schema](/framework/concepts/request-validation/) on any of them is checked here.

The body is read lazily, **only if some parameter asks for it**, and at most once:

| Problem | Status |
| --- | --- |
| Body isn't `application/json` | `415` |
| Larger than `bodyLimit` (declared or counted while streaming) | `413` |
| Cut off before it was fully received | `400` |
| Not valid JSON | `400` |
| Fails its schema | `400` with `issues` |

A route with no `@Body` never touches the body stream at all.

## 8. The handler, then the response

The handler runs as an ordinary method. What it returns becomes the response:

- A plain value is serialized as JSON with status `200`, or the code from `@HttpCode`.
- `undefined` is an empty `204`.
- A `Response` is passed through untouched. It is also exempt from response validation, which makes it the way to stream a body.

A plain value is first checked against the route's [`@Returns` schema](/framework/concepts/response-validation/). A mismatch is a `500`: the client never sees the internal shape, and the problem is logged.

## 9. Errors become responses

Anything thrown in stages 5 to 8 is caught in one place:

- An [`HttpException`](/framework/concepts/error-handling/) becomes its status as `application/problem+json`.
- Anything else is logged and answered with a generic `500 An unexpected error occurred`. The message is never sent to the client.

## 10. Disconnects and timeouts, while the work runs

Interceptors and the handler run in a race against the request's signal:

- If the **client disconnects**, the response is a `499`. Nobody receives it, since the connection is gone; it only marks the outcome as a client abort rather than a success or a server error.
- If **`requestTimeout`** fires first, the response is a `504`.

The race does not cancel the work. A handler that ignores `request.signal` keeps running to its end, in its own `RequestContext` scope, and its late result is discarded. Guards are not part of the race.

## 11. The `Response` goes back out

`listen()` writes the status and headers, then pipes the body with backpressure, so a client that reads slowly doesn't make the server buffer a large stream. If the client disconnects mid-response, the body stream is cancelled so its producer stops. A response for a client that is already gone is dropped.

## Next

- The two entry points in detail: [Running in Production](/framework/guides/running-in-production/) for `listen()`, [Deploying](/framework/guides/deploying/) for `createFetchHandler`.
- Where to hook in: [Guards](/framework/concepts/guards-and-authorization/), [Interceptors](/framework/concepts/interceptors/), [Error Handling](/framework/concepts/error-handling/).
