---
"@blixis-io/auth": minor
---

Add `RequireScopes(...scopes)` and `apiKeys.scopedRoutesOnly`. An API key must hold all of a route's scopes or the request is a 403; a request authenticated with a token is not held to scopes. With `scopedRoutesOnly: true` a key is refused on any route that does not declare scopes. `JwtAuthGuard` now accepts tokens only (an API key has to come through `AuthGuard`, which checks scopes).
