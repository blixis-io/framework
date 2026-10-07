# @blixis-io/http

## 0.9.1

### Patch Changes

- [#152](https://github.com/blixis-io/framework/pull/152) [`f70a9dd`](https://github.com/blixis-io/framework/commit/f70a9ddbddefd3b518aa7f7488c92cfefe8eba81) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Write responses to the socket with a plain loop over the body's reader instead of `pipeline(Readable.fromWeb(body), res)`, and compute the listening address once instead of on every request. `pipeline` created an `AbortController` and a `DOMException` with a stack trace on every response; on the benchmark's `ping` route the server's CPU per request drops from 58.7 to 35.1 µs (bare `node:http` is 17.9). Behaviour is unchanged: backpressure, cancelling the body's source when the client disconnects, and destroying the response when the body fails are kept and are now covered by tests over a real socket.

## 0.9.0

### Minor Changes

- [#124](https://github.com/blixis-io/framework/pull/124) [`086eaa8`](https://github.com/blixis-io/framework/commit/086eaa817844318bc1e0bd113cea8da5dcb2d009) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - `HttpApplication` has a `draining` flag and a `startDraining()` method. `draining` is `true` from the moment `close()` is called (so a request still being served can see it) or `startDraining()` has been called; `startDraining()` marks the application as draining without closing anything, for the shutdown sequence a load balancer needs: on the signal, start draining so readiness reports "not ready", wait for the balancer's health check to notice, then `close()`. Closing first refuses connections before the balancer knows to stop using the instance. Nothing else changes. `@blixis-io/health` builds the readiness endpoint on it.

- [#121](https://github.com/blixis-io/framework/pull/121) [`416994a`](https://github.com/blixis-io/framework/commit/416994a92e1d152199eb70734fa6de0e806f3545) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - New `currentRemoteAddress()`: the address of the peer that connected, for the request being served, readable from a middleware, a guard, a controller or a service. The Node adapter records the socket's address when it builds the `Request`, and `HttpApplication.handle()` puts it in the request scope the handler adopts (an IPv4 peer of a dual-stack socket is written plainly, `203.0.113.7` and not `::ffff:203.0.113.7`). It is `undefined` outside a request and for a request with no socket (in-process `handle()`, `createFetchHandler`). No header is trusted: behind a reverse proxy this is the proxy. It is what a rate limiter or an allow list needs; `@blixis-io/security` builds the proxy-aware `getClientIp()` on it.

### Patch Changes

- [#122](https://github.com/blixis-io/framework/pull/122) [`02329a4`](https://github.com/blixis-io/framework/commit/02329a42ab7c1946e981625b0221e09e7ee05f13) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - A middleware that throws now reaches the middleware outside it as a response, the way a failure in the application already did. Before, an error thrown by an inner middleware (a rate limiter throwing a `429`, an auth check throwing a `401`) travelled up as a rejection through the outer ones and was turned into a response only at the very top, so a middleware placed first, such as CORS or an access log, never saw that response and could not add its headers to it or record its status. Now `next()` never rejects: an `HttpException` becomes its problem+json response and any other error a logged generic `500`, and each outer middleware receives that `Response`. Behaviour change: a middleware that wrapped `next()` in `try`/`catch` to see an inner middleware's error now gets a response instead.

- [#125](https://github.com/blixis-io/framework/pull/125) [`d8ba3d1`](https://github.com/blixis-io/framework/commit/d8ba3d1a99f38ef0b7a792912585c75dc4cc42d0) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - A shutdown hook that fails while a failed boot is rolled back (inside `@blixis-io/core`, before the HTTP handler is even built) now reaches `onError` with `phase: "shutdown"`, like the one from a failed handler build already did. Before it was written with `console.error` whatever `onError` said. Without `onError` the output is unchanged.

- [#133](https://github.com/blixis-io/framework/pull/133) [`1a34fc4`](https://github.com/blixis-io/framework/commit/1a34fc4afa9874f825eae7ac3d5d75b83600a399) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - An `error` event on the Node HTTP server after it started listening no longer takes the process down. Without a listener Node rethrows it as an uncaught exception (running out of file descriptors is the usual cause), ending the process with every request in flight. `listen()` now keeps a listener for the life of the server and reports the error to `onError` with the new `phase: "server"`, or to `console.error` without it; the process keeps serving what it can. An error before the server started (the port is taken) still rejects `listen()` as before.
- Updated dependencies [[`d8ba3d1`](https://github.com/blixis-io/framework/commit/d8ba3d1a99f38ef0b7a792912585c75dc4cc42d0)]:
  - @blixis-io/core@0.5.0

## 0.8.0

### Minor Changes

- [#104](https://github.com/blixis-io/framework/pull/104) [`5f9c5ea`](https://github.com/blixis-io/framework/commit/5f9c5ea9ea541d61328e200b2b539027216ab3f0) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Unexpected errors can now go to your logger. New `onError` option on `createHttpApplication` and `createFetchHandler` receives every unexpected error (a controller, guard, interceptor or middleware throwing something that is not an `HttpException`, or a boot failure under `createFetchHandler`) with the `request`, the matched `route` and the `requestId`; without it the error is written with `console.error` as before, and an `onError` that throws is caught. New opt-in middleware: `requestId()` (keeps an acceptable client `x-request-id`, else a UUID; stored in the `RequestContext`, set on every response, readable with `currentRequestId()`) and `accessLog({ log })` (method, path without the query, status, duration, request id; every request, including a `404`). New helper `withResponseHeaders(response, headers)`, which copes with immutable response headers (`Response.redirect()`, a `fetch()` response) where `response.headers.set()` would throw. Exports `ErrorReport`, `ErrorReporter`, `AccessLogEntry`, `AccessLogOptions` and `RequestIdOptions`.

- [#103](https://github.com/blixis-io/framework/pull/103) [`6146198`](https://github.com/blixis-io/framework/commit/61461988b362941b0d231bb39a7f19bec91273e7) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - New `middleware` option on `createHttpApplication` and `createFetchHandler`: an array of `(request, next) => Response` functions, outermost first, that wrap every request: routed, mounted, and the ones the router refuses (`404`, `405`, malformed path), plus guard denials, validation errors, controller errors and timeouts. A middleware can answer without calling `next()`, hand on a changed `Request`, or throw (an `HttpException` becomes its problem+json, anything else a logged generic `500`). The chain runs inside a `RequestContext` scope that the guards and controller share, so a value a middleware sets is what they read. It sits outside `requestTimeout`, and sees the response as created, not the end of a streamed body. Exports `Middleware`, `NextFunction` and `MiddlewareOptions`. Nothing changes when the option is not set.

### Patch Changes

- [#98](https://github.com/blixis-io/framework/pull/98) [`cfa6381`](https://github.com/blixis-io/framework/commit/cfa6381bdda97bc9e22ffe0f2c32d12fc2453702) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - A boot that fails while building the HTTP handler (a duplicate route, a class without `@Controller()`, a `@GlobalGuard()` without `canActivate`) now shuts down the providers the core application had already initialised, then rejects with the original error. Before, their `onApplicationShutdown` hooks never ran, so a database pool opened during boot stayed open; with `createFetchHandler`, every retried boot added another. A hook that fails during this rollback is logged and does not replace the boot error.

- [#100](https://github.com/blixis-io/framework/pull/100) [`2216bc0`](https://github.com/blixis-io/framework/commit/2216bc0d93bb681b82583200814d1caa993bc098) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - `requestTimeout` now covers the whole request. Before, only interceptors and the handler were raced against the deadline, so a guard that never settled meant no `504` at all, and handlers registered with `mount()` had no deadline. Routing, guards, argument parsing, interceptors, the handler and mounted handlers now share one budget, and the `request` a guard receives carries the deadline in its `signal`. A late guard also no longer starts more work: once the deadline has passed (or the client has left), the next guard and the controller method are not called, where before a guard settling after the `504` still let the controller run. This only applies when `requestTimeout` is set. Work already running is still not cancelled; it has to watch `request.signal`.

- [#99](https://github.com/blixis-io/framework/pull/99) [`47566bc`](https://github.com/blixis-io/framework/commit/47566bcfcf9c9a554e14c9afebccc29f71a06dbe) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - `HttpApplication.close()` now returns one shared promise. Before, a second `close()` made while the first was still draining requests skipped the drain and ran the shutdown hooks straight away, so a database pool could be closed under requests that were still running (a signal handler plus a test's cleanup, which the docs say is safe, was enough). Every caller now waits for the same drain and teardown, the hooks run once, and a failing hook rejects every caller with the same error. `listen()` now rejects if the application is already listening or has been closed, instead of replacing the first server and losing the handle to it.

- [#96](https://github.com/blixis-io/framework/pull/96) [`3329a9c`](https://github.com/blixis-io/framework/commit/3329a9c88c3b64724670c20a6809526fca3ef5b8) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Router: a route only matches the method it was registered with, so a request falls through to the next candidate instead of being refused by a sibling that has other methods only. With `POST /posts/new` and `GET /posts/:id`, `GET /posts/new` used to answer `405` (`Allow: POST`) and now reaches `GET /posts/:id`; the same holds for a wildcard sibling. A real `405` now lists the methods of every route that matches the path. Behaviour change: a request that used to get a `405` can now reach a handler. Guards still run only for the route that is finally matched.

## 0.7.0

### Minor Changes

- [#85](https://github.com/blixis-io/framework/pull/85) [`13e89f8`](https://github.com/blixis-io/framework/commit/13e89f8030871d6cd1937959d48d6ad2a594cf2a) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Four `http` fixes found in the code review, and the `auth` change that uses one of them.
  
  **`request.url` has the right origin.** `listen(0)` used to produce `http://127.0.0.1:0/...` (the requested port, not the bound one), and the `Host` header never mattered. The origin now uses the port actually bound, and IPv6 listen addresses are bracketed (`listen(3000, "::1")` threw). Client headers are still ignored by default, because they are client input. New options opt in: `trustHostHeader` (origin from `Host`) and `trustProxy` (from `X-Forwarded-Proto` and `X-Forwarded-Host`, else `Host`). Only a bare `host[:port]` and an `http`/`https` scheme are accepted; anything else falls back to the listen address. If you build absolute links from `request.url`, you probably want one of these options (or better, a configured public URL).
  
  **JSON media type compared exactly.** The check was a prefix match, so `application/jsonp` and `application/json5` passed as JSON. Now `application/json` and `+json` types (`application/vnd.api+json`) are accepted, a `charset` other than UTF-8 is a `415` (the body was always read as UTF-8), and everything else is a `415` as before.
  
  **`WWW-Authenticate` on a 401.** `UnauthorizedException(detail, challenge?)` sends the challenge as `WWW-Authenticate`, as RFC 9110 requires for a 401. `HttpException` takes a fourth `headers` argument for the same purpose (`retry-after` on a 429, say). Without a challenge nothing is sent, as before. `@blixis-io/auth` now sends `Bearer` when no token was supplied and `Bearer error="invalid_token"` for a token that fails verification or the claims schema (RFC 6750).
  
  **Problem titles from one table.** `422`, `429`, `503` and every other registered 4xx/5xx status now get their reason phrase as `title`; before, only ten statuses did and the rest were titled `"Error"`.

## 0.6.1

### Patch Changes

- [#83](https://github.com/blixis-io/framework/pull/83) [`b1c63e3`](https://github.com/blixis-io/framework/commit/b1c63e38a5450eabec5e129ff9489c1c6adf1a50) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Two router bugs fixed.
  
  **Param names are per route.** Before, `GET /posts/:id` plus `DELETE /posts/:postId` registered without error, but the second handler was given the param under the first route's name, so `@Param("postId")` was `undefined`. Each route now gets its values under its own names.
  
  **Path params are percent-decoded.** Before, `GET /posts/hello%20world` gave the handler `"hello%20world"`, and a static route written as `@Get("café")` never matched `/caf%C3%A9`. Each path segment is now decoded once before matching (`%2F` stays inside its segment, `+` is not a space, `%2520` becomes `%20`). A path with a broken escape (`/posts/100%`) is answered `400 Malformed percent-encoding in the request path` before any guard or handler runs. `Router.match` reports it as a new `malformed-path` result (type `RouteMalformedPath`); code that calls `Router.match` directly and switches over its result kinds needs a case for it.
  
  **Check before upgrading:** if a handler calls `decodeURIComponent` on a param itself, remove that call. It was harmless on the old encoded value but throws on a decoded value that contains a `%`.

## 0.6.0

### Minor Changes

- [#76](https://github.com/blixis-io/framework/pull/76) [`9746012`](https://github.com/blixis-io/framework/commit/9746012b8513e6039a27978946ea4d07abb65f69) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - `@blixis-io/core`, `@blixis-io/di`, `@blixis-io/http`, `zod` and `drizzle-orm` are now **peer dependencies** of the packages that build on them, instead of exact-version dependencies. Before, the libraries pinned exact versions (for example `auth` required `core 0.3.1`), so upgrading `core` by a patch left every library on its own older copy and the app ended up with two. Now your project installs each once and every package shares it; a version that doesn't fit is reported by the package manager at install time.
  
  **What you need to do:** make sure your project depends on what the packages you use build on. pnpm and npm 7+ install missing peers automatically; with yarn or bun, or to be explicit, add them. Per package:
  
  - `core`: `di`
  - `http`: `core`, `di`, `zod`
  - `auth`, `tenancy`, `testing`: `http` (and so `core`, `di`, `zod`); `tenancy` also `drizzle-orm`
  - `openapi`: `http`, `di`, `zod`
  - `config`: `core`, `di`, `zod`
  - `events`, `logging`: `core`, `di`
  - `db`: `core`, `di`, `drizzle-orm` (`pg` is still installed for you)
  
  `create-blixis` now installs `zod`, which `@blixis-io/http` needs. See Installation in the docs for the full table.

### Patch Changes

- Updated dependencies [[`9746012`](https://github.com/blixis-io/framework/commit/9746012b8513e6039a27978946ea4d07abb65f69)]:
  - @blixis-io/core@0.4.0

## 0.5.0

### Minor Changes

- [#74](https://github.com/blixis-io/framework/pull/74) [`6216026`](https://github.com/blixis-io/framework/commit/6216026a68363c4d901509d0116d52e447c95039) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Export `RequestContextModule`, the global module `createHttpApplication` already used to provide `RequestContext`. Entry points that boot an app without the HTTP layer can now import it, so providers that inject `RequestContext` still resolve there.

### Patch Changes

- [#69](https://github.com/blixis-io/framework/pull/69) [`e1c471e`](https://github.com/blixis-io/framework/commit/e1c471e79715ca18ccfc009a1912e2b20f41eb08) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Treat a request body cut off by the client (a disconnect or half-close before the declared length arrived) as `400 Bad Request` instead of an unexpected `500`, and skip writing a response to a client that is already gone. Neither case logs a server error any more; previously each such disconnect logged two stack traces.

## 0.4.0

### Minor Changes

- [#60](https://github.com/blixis-io/framework/pull/60) [`3b7c4c8`](https://github.com/blixis-io/framework/commit/3b7c4c8ff0e23d1e88a3dbc800adcbc45d9583f6) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Guards and interceptors now receive `controller` and `handler` in their `ExecutionContext`, so they can tell which route is being handled. New `SetRouteMetadata(key, value)` / `getRouteMetadata(key, context)` attach metadata to a controller or a single route and read it back (the method's own value wins, else the controller's): the building block for decorators such as `@Roles` and `@Public`. New `@GlobalGuard()` marks a guard that runs on every route before the route's own guards; it is found among the application's providers (so it still has to be registered), several run in dependency order, and a marked class without `canActivate()` fails the boot. **Type-level change:** code that builds an `ExecutionContext` by hand (typically a unit test) now needs `controller` and `handler` too.

## 0.3.2

### Patch Changes

- Updated dependencies [[`3b2d859`](https://github.com/blixis-io/framework/commit/3b2d85957cba17f6cfc6273f327c042b25d7ca36)]:
  - @blixis-io/di@0.1.2
  - @blixis-io/core@0.3.1

## 0.3.1

### Patch Changes

- Updated dependencies [[`4c34195`](https://github.com/blixis-io/framework/commit/4c34195a621dabc5d2f31e7a4eeed54a2dbc6d45)]:
  - @blixis-io/core@0.3.0

## 0.3.0

### Minor Changes

- [#40](https://github.com/blixis-io/framework/pull/40) [`bf86ca7`](https://github.com/blixis-io/framework/commit/bf86ca7bb675e0e735a86f37caa6f44d050938f4) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - New `createFetchHandler(AppModule, options?)` for platforms that call `fetch(request)` per request (Vercel, Netlify, Cloudflare Workers): `export default createFetchHandler(AppModule)`. It boots the app lazily on the first request and shares that boot between concurrent requests. A failed boot answers a generic 500 (the error is logged, never sent to the client) and is retried on the next request instead of being cached. Checked running in the local Workers runtime.

- [#33](https://github.com/blixis-io/framework/pull/33) [`356e859`](https://github.com/blixis-io/framework/commit/356e859423426fd3984f8a79ec31e315f5809818) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - New `responseValidation: "always" | "never"` option (default `"always"`) and per-route `@Returns(schema, { validate })` override, which wins in either direction. Skipping validation sends the handler's value as-is, so the schema's coercion, defaults and stripping of unknown keys no longer apply; the schema still feeds the OpenAPI document. Response parsing is now synchronous (3-4x faster on large payloads) with an automatic fallback to async for schemas with async refinements. Documents the schema's role as an output allow-list.

### Patch Changes

- [#35](https://github.com/blixis-io/framework/pull/35) [`344bc43`](https://github.com/blixis-io/framework/commit/344bc435f3ce6352f08dcd8ac1e70a81d6da89e4) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - A client that disconnects while a streamed response is being written now cancels the response's source stream. Before, the stream was left running, so its producer (a DB cursor, a file handle) was never released. `sendWebResponse` now uses `stream.pipeline` and treats an early disconnect as normal rather than an error.
- Updated dependencies [[`fe1f67a`](https://github.com/blixis-io/framework/commit/fe1f67af5657af8d0d2a1ba8ca0aef400617d597)]:
  - @blixis-io/di@0.1.1
  - @blixis-io/core@0.2.1

## 0.2.0

### Minor Changes

- [#28](https://github.com/blixis-io/framework/pull/28) [`9fa4c06`](https://github.com/blixis-io/framework/commit/9fa4c0686fad9bdb6ae95630fdfd739917be87ff) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - New `HttpApplication.mount(method, path, handler)`: serves an exact path with a plain Web-standard handler ahead of the router, for framework-level endpoints that need the finished app. Mounted routes bypass guards and interceptors; mounting the same method and path twice throws.

- [#25](https://github.com/blixis-io/framework/pull/25) [`cbc09de`](https://github.com/blixis-io/framework/commit/cbc09de1c8b2fa16d183f2d3b95d0e922c44e7e7) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - - Request body limit is now enforced while streaming; chunked bodies without `Content-Length` are cancelled once over the limit instead of being buffered whole.
  - New opt-in `requestTimeout` option: a request that outlives it answers 504, and `request.signal` aborts at the deadline so handlers can cancel downstream work. A client disconnect during a guarded request answers 499. Adds `GatewayTimeoutException`.
  - `toWebRequest` takes an optional `ServerResponse` and aborts the request signal when the response closes unfinished (Node's `aborted` event is deprecated and misses some disconnects).
  - New `shutdownTimeout` option (default 10 000 ms, `Infinity` to wait): `close()` drops idle keep-alive sockets, lets in-flight requests finish, then destroys what is still running, aborting its signal.

### Patch Changes

- Updated dependencies [[`cbc09de`](https://github.com/blixis-io/framework/commit/cbc09de1c8b2fa16d183f2d3b95d0e922c44e7e7)]:
  - @blixis-io/core@0.2.0
