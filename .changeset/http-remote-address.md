---
"@blixis-io/http": minor
---

New `currentRemoteAddress()`: the address of the peer that connected, for the request being served, readable from a middleware, a guard, a controller or a service. The Node adapter records the socket's address when it builds the `Request`, and `HttpApplication.handle()` puts it in the request scope the handler adopts (an IPv4 peer of a dual-stack socket is written plainly, `203.0.113.7` and not `::ffff:203.0.113.7`). It is `undefined` outside a request and for a request with no socket (in-process `handle()`, `createFetchHandler`). No header is trusted: behind a reverse proxy this is the proxy. It is what a rate limiter or an allow list needs; `@blixis-io/security` builds the proxy-aware `getClientIp()` on it.
