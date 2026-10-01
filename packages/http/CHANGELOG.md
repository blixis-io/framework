# @blixis-io/http

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
