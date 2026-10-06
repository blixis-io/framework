# @blixis-io/security

## 0.1.0

### Minor Changes

- [#123](https://github.com/blixis-io/framework/pull/123) [`29f154e`](https://github.com/blixis-io/framework/commit/29f154e4447be31c93be24831e03b55b38b3267e) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - First release: an optional production baseline for `@blixis-io/http`, as plain middleware. `cors()` with explicit origins, preflight handled without routes, `Vary: Origin`, and `credentials: true` with `"*"` refused when it is created. `securityHeaders()` with conservative JSON-API defaults (`nosniff`, `no-referrer`, `DENY`, a deny-everything CSP, `same-origin` resource policy; HSTS only when asked). `rateLimit()`: a fixed window per key with a pluggable atomic `RateLimitStore`, `RateLimit-*` headers, a `429` problem document with `Retry-After`, several named limits sharing a store, `match` to limit only sign-in and refresh, and `onStoreError` to fail open or closed. A bounded in-memory store for development and a single instance; a Postgres store, tested against a real database with two instances sharing one limit, is in the docs. `getClientIp()`, which reads `X-Forwarded-For` only as far as you say (`trustedProxyHops`, counted from the end, optionally only from a trusted peer) and never uses the part a client controls.

### Patch Changes

- Updated dependencies [[`086eaa8`](https://github.com/blixis-io/framework/commit/086eaa817844318bc1e0bd113cea8da5dcb2d009), [`02329a4`](https://github.com/blixis-io/framework/commit/02329a42ab7c1946e981625b0221e09e7ee05f13), [`416994a`](https://github.com/blixis-io/framework/commit/416994a92e1d152199eb70734fa6de0e806f3545), [`d8ba3d1`](https://github.com/blixis-io/framework/commit/d8ba3d1a99f38ef0b7a792912585c75dc4cc42d0), [`1a34fc4`](https://github.com/blixis-io/framework/commit/1a34fc4afa9874f825eae7ac3d5d75b83600a399)]:
  - @blixis-io/http@0.9.0
