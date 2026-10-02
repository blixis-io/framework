# @blixis-io/http

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
