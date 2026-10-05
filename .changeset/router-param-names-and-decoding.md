---
"@blixis-io/http": patch
---

Two router bugs fixed.

**Param names are per route.** Before, `GET /posts/:id` plus `DELETE /posts/:postId` registered without error, but the second handler was given the param under the first route's name, so `@Param("postId")` was `undefined`. Each route now gets its values under its own names.

**Path params are percent-decoded.** Before, `GET /posts/hello%20world` gave the handler `"hello%20world"`, and a static route written as `@Get("café")` never matched `/caf%C3%A9`. Each path segment is now decoded once before matching (`%2F` stays inside its segment, `+` is not a space, `%2520` becomes `%20`). A path with a broken escape (`/posts/100%`) is answered `400 Malformed percent-encoding in the request path` before any guard or handler runs. `Router.match` reports it as a new `malformed-path` result (type `RouteMalformedPath`); code that calls `Router.match` directly and switches over its result kinds needs a case for it.

**Check before upgrading:** if a handler calls `decodeURIComponent` on a param itself, remove that call. It was harmless on the old encoded value but throws on a decoded value that contains a `%`.
