# @blixis-io/http

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
