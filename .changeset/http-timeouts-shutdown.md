---
"@blixis-io/http": minor
---

- Request body limit is now enforced while streaming; chunked bodies without `Content-Length` are cancelled once over the limit instead of being buffered whole.
- New opt-in `requestTimeout` option: a request that outlives it answers 504, and `request.signal` aborts at the deadline so handlers can cancel downstream work. A client disconnect during a guarded request answers 499. Adds `GatewayTimeoutException`.
- `toWebRequest` takes an optional `ServerResponse` and aborts the request signal when the response closes unfinished (Node's `aborted` event is deprecated and misses some disconnects).
- New `shutdownTimeout` option (default 10 000 ms, `Infinity` to wait): `close()` drops idle keep-alive sockets, lets in-flight requests finish, then destroys what is still running, aborting its signal.
