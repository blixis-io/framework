# Plan: acting on the external review

Written 2026-10-06. Inputs: the ChatGPT review, my check of it ([`EXTERNAL-REVIEW-ASSESSMENT.md`](./EXTERNAL-REVIEW-ASSESSMENT.md)), the earlier [`review.md`](./review.md) and [`TODO.tmp.md`](./TODO.tmp.md). Work items with checkboxes are in [`TASKS.md`](./TASKS.md); this file holds the reasoning and designs.

## Goal

Make the existing packages behave predictably under failure, shutdown and upgrade, and prove it with one maintained example application. No new packages until the correctness phase is done, except the small ones that phase 1 needs.

## Principles

- **Reproduce first.** Every fix starts with a test that fails on the current code. Four defects are already reproduced (assessment, items 1, 2, 7); their scripts become the tests.
- **One PR per item**, with a changeset when a published package changes, and docs in the same PR (the repo's existing rule).
- **Fix the docs when the docs are wrong**, and the code when the docs are right. Two places need this: `close()` "is a no-op the second time", and `requestTimeout` "the client gets a 504".
- **Keep it small.** Understandable internals are the product. Prefer one option or one hook over a new abstraction.
- **Don't redo existing work.** CI hardening is already on branch `ci/supply-chain-hardening`; finish it.

## Overlap with the existing backlog

| New from the ChatGPT review | Already tracked |
| --- | --- |
| Router 405 fallback (X-1) | none (BUG-1/2 fixed in #83, this case not covered) |
| Deadline covers guards and mounted routes (X-2) | none (REL-4 touches the same option) |
| HTTP boot rollback, shared close, repeated `listen()` (X-3, X-4) | none (BUG-12 is adjacent) |
| OpenAPI media type, security, optional body (X-5) | none; `@ApiResponse` idea in TODO section 5 |
| Refresh-token atomicity, families, double refresh (X-9) | TODO P6 "refresh and session helpers" |
| Tenant integration suite and patterns (X-8) | `@TenantScoped` idea only |
| Middleware boundary (X-6) | roadmap sentence in the production guide |
| Security baseline (X-7) | SEC-5 `[decide]` |
| Observability and health (X-10) | MNT-3, REL-5, P6 `@blixis-io/health` |
| Release hardening (X-11) | SEC-3, SEC-4, PERF-7, CI-4, MNT-6; TODO item 10 (branch in progress) |
| Fresh-install CI, Windows/macOS (X-12) | TST-5 |
| Outbox recipe (X-15) | documented deferral in `events.md` |

## Phases

### Phase 0: correctness (do first, all small)

Order matters only a little; X-1 to X-4 are independent and each is under a day.

#### X-1 Router: method-aware fallback

**Problem [R]:** `walk()` returns the first node with any route; `match()` then checks the method. `GET /posts/new` hits the 405 for `POST /posts/new` instead of falling through to `GET /posts/:id`. Same with wildcards.

**Design:** pass the method into `walk`. At the end of a path, a node counts as a match only if it has the method. Keep the precedence static, then param, then wildcard. While walking, collect the methods of every node that matched the path but not the method. If nothing matched with the method: if any node matched the path, answer 405 with the union of collected methods as `Allow`; otherwise 404. The wildcard branch needs the same check (today it returns without looking at the method).

**Behaviour change to call out:** a request that used to get 405 may now reach a handler. Guards run only for the route that is finally matched, so no guard sees a request it didn't before. Say so in the changeset.

**Tests:** static POST + param GET; nested dead ends; static + param + wildcard overlaps; `Allow` is the union for a true 405; unchanged precedence when the method matches. Add a small property test later (X-13).

**Docs:** one paragraph in `request-path.md` stating the rule.

**Risk:** low. Size S. Package: http, patch.

#### X-2 Deadline covers the whole request

**Problem [R]:** a guard that never settles means no 504, and mounted handlers have no deadline.

**Design:**
1. Treat "guards, then interceptor pipeline, then handler" as one `execute()` promise and race that against the abort signal (move `raceAbort` up in `handler.ts`).
2. **Stop work after the deadline.** Between guards and before invoking the controller, check `request.signal.aborted` and stop. Without this, a late guard still lets the handler run after the client got a 504 (reasoned, see assessment item 2). Return value of a stopped run is ignored, like the late result today.
3. Mounted handlers: apply the same deadline and 504/499 mapping in `HttpApplication.handle`. Prefer one small internal `withDeadline(request, run)` used by both, rather than duplicating the race.
4. Fix the option's doc: a 504 never means the work was cancelled; cooperative code must watch `request.signal`.

**Tests:** hanging guard returns 504 within the budget; hanging mounted handler returns 504; a guard that settles after the deadline does not call the controller (spy); a client disconnect during a guard gives 499 and aborts the signal the guard sees.

**Risk:** low to medium; the order of `try/catch` and context must stay the same. Size S to M. Package: http, patch.

#### X-3 HTTP boot rolls back

**Problem [R]:** `HttpApplication.create` builds the router after the core app is up; a throw (duplicate route, `NotAControllerError`, a global guard without `canActivate`) leaves providers open.

**Design:** wrap `createHandler` in try/catch, `await app.close()`, rethrow the original error. If `close()` itself fails, log it and still throw the original error (same stance as core's `rollBack`). Cover `createFetchHandler`'s retry path in a test too (the TODO lists it as not covered).

**Tests:** the duplicate-route scenario asserts the earlier provider's shutdown hook ran, and the original error type is what rejects. Size S. Package: http, patch.

#### X-4 Shared close, single `listen()`

**Problem [R]:** the second of two concurrent `close()` calls skips the drain and closes the application while a request is still running. Reasoned [V]: calling `listen()` twice overwrites `#server` and leaks the first; a server `error` after start is unhandled (BUG-12).

**Design:**
- Keep one `#closing: Promise<void>`. The first call creates it (server drain, then `app.close(signal)`); every later call returns the same promise. The first call's `signal` wins; document that.
- `listen()` throws a clear error if already listening; if `listen` fails, make sure the server is discarded.
- Attach a persistent `error` listener after start that logs (BUG-12).
- Hook deadline: a hook that never settles still blocks `close()`. Document that first (what happens, what `shutdownTimeout` does and does not cover). Adding `shutdownHookTimeout` is **decision D-5**; do not build it speculatively.

**Tests:** reproduce the 600 ms request scenario: the hook runs after the request completes for both callers, and both promises settle together. Repeated `listen()` errors. Size S to M. Package: http, patch (possibly core, patch, if the hook timeout is chosen).

#### X-5 OpenAPI matches reality

**Problems [V]:** errors documented as `application/json` but sent as `application/problem+json`; no security schemes; `requestBody.required` always true; undefined result is 204 but documented 200; `operationId` can collide.

**Design:**
1. Error responses use `application/problem+json` and the `Problem` schema. Tiny fix, do it first.
2. Security: `OpenApiDocumentOptions` gets `securitySchemes` and a document-level `security`; a route-level opt-out/override needs route metadata. Implement as `@ApiSecurity(...)` in openapi, so openapi stays independent of auth. Pairing with `@Public` automatically is a follow-up, not part of this.
3. Optional body: `required` is true unless the schema accepts `undefined` (`safeParse(undefined).success`).
4. Status: keep `@HttpCode` and `@Returns` as the source. For a route whose schema accepts `undefined`, also document `204`. Do not try to infer from handler code; point to the planned `@ApiResponse` for explicit control.
5. Unrepresentable schemas: add `onUnrepresentable: "open" | "warn" | "throw"` (default `"open"`, today's behaviour) so a CI build can fail on a silently open schema.
6. Validate `operationId` uniqueness at generation time and throw with both controller names.

**Tests:** contract test that boots a real app, calls representative routes, and checks the media type and status of real responses against the generated document; schema-validate the document with a dev-only OpenAPI validator; a generated-client smoke test is optional. Size M. Package: openapi, minor (new options), maybe http if route metadata is needed.

### Phase 1: production baseline

#### X-6 One request-wide wrapper

**Problem [V]:** nothing runs for 404/405/400-path responses or mounted routes, and `listen()` users cannot wrap `handle`.

**Design (proposal, needs D-1):** `HttpApplicationOptions.middleware?: Middleware[]` with `type Middleware = (request: Request, next: (request: Request) => Promise<Response>) => Response | Promise<Response>`.
- It wraps `HttpApplication.handle` entirely: mounted handlers, routing failures, controller routes.
- Order, outermost first: middleware, then (inside it) deadline, then routing, then guards, interceptors, handler.
- The middleware sees a `Response`, not stream completion. Document it.
- Same option on `createFetchHandler`.
- No `app.use()` and no per-route middleware; interceptors already do per-route work.

**Ordering question for D-2:** should the request context (`AsyncLocalStorage`) start outside the middleware, so an access log can read a request id? Recommendation: yes. It is the one reason for middleware to know the context at all.

**Tests:** middleware sees 404, 405, 400 (malformed path), 403, validation 400, controller 500, mounted endpoint, and a 504. Short-circuit; error thrown inside middleware becomes a logged 500 problem response. Size M. Package: http, minor.

#### X-7 Optional security baseline (after X-6)

**Design:** a new small package `@blixis-io/security` (recommendation already in the TODO) with middleware factories, nothing on by default:
- `cors({ origins, methods, headers, credentials, maxAge })`: explicit origins only; `credentials: true` with `"*"` is a construction error; handles preflight; rejection and error responses still carry CORS and security headers (works because it sits outside everything).
- `securityHeaders(options)`: conservative defaults, each overridable.
- `rateLimit({ store, key, limit, window })` with a `RateLimitStore` interface and an in-memory store marked development-only (not shared across replicas). A Redis or Postgres store is an example in the docs, not a dependency.
- **Client IP:** the Node adapter currently throws away the socket address. Expose it, then offer `getClientIp(request, { trustProxy })`. Without this, rate limits keyed by IP cannot exist. How to expose it (a symbol on the request, a field on `RequestContext`, or an option to the middleware) is **decision D-3**.
- Docs: a deployment recipe where the proxy overwrites forwarded headers and the backend is not directly reachable.
- Apply first to sign-in and refresh routes in the example app.

**Tests:** preflight from a browser-like request; credentials + wildcard refused; a 429 keeps its headers; two instances sharing a store enforce one limit (integration test with Postgres, which CI already has). Size L. Needs a `0.0.0` placeholder and trusted publisher on npm first **[you]**.

#### X-8 Tenant isolation: tested patterns

**Problem [V]:** `tenantScope()` is opt-in per query and the guard proves membership only. `assertSameTenant` exists but isn't shown as the pattern.

**Design:** no new abstraction first. Write a real-Postgres integration suite in `packages/tenancy` with two tenants and these attacks: read, update, delete and insert across tenants; a forged `spaceId` in the route for a space the actor isn't in; a valid space with another space's resource id (id substitution); joins; a command or background job with no tenant (must fail closed). Where the suite shows repeated awkward code, add a helper then (candidates: an insert helper that stamps tenant columns, composite `(id, space_id)` unique keys and foreign keys so a child can't point at another tenant's parent). Docs: a worked repository example, the explicit privileged-operation pattern, and an optional Postgres row-level-security recipe with its pool/transaction caveats, clearly marked defence in depth and **unverified until a test proves it**.

**Done when:** the suite passes and the docs stop implying the helper isolates everything. Size M. Package: tenancy, minor if helpers are added.

#### X-9 Refresh tokens: resilience

**Problems [V]:** non-atomic rotate-then-create; reuse revokes every device; a double refresh by an honest client looks like reuse.

**Design:**
1. Optional `RefreshTokenStore.rotate(oldHash, newHash, record): Promise<boolean>` that marks the old token rotated and creates the successor in one atomic step. If present, `AuthService` uses it; if absent, today's behaviour, so existing stores keep working.
2. Optional `familyId` on `RefreshTokenRecord`/`create`: reuse revokes the family when present, the subject otherwise. Sign-out of one device then doesn't touch others.
3. **Decision D-4:** a short grace window for a just-rotated token (the same client retrying), returning 401 without revoking. Trade-off: weaker reuse detection inside the window. My recommendation: a small configurable window, default off.
4. Reference Postgres store as documentation plus the example app, not a new dependency of `auth` (it has no drizzle dependency).
5. Document what refresh revocation does not do: already-issued access tokens stay valid until `exp`. Offer short TTLs as the answer; an optional `isRevoked` hook in the guard is a later option (**D-6**).

**Tests:** real-store tests: simultaneous refresh, reuse, failure between rotate and create (atomic path leaves the old token usable), expiry, sign-out, two devices unaffected by each other. Size M to L. Package: auth, minor (additive).

#### X-10 Observability and health

**Design (small steps):**
1. `HandlerOptions.onError(error, { request, route? })`; default stays `console.error`. All five direct `console.error` sites go through one reporting function, so a logger can be plugged in. Events get the same hook for listener failures (REL-5).
2. A request id: accept an incoming `x-request-id` only when well formed, else generate; put it in `RequestContext` and on the response. Lives in the X-6 middleware set, not in core.
3. `HttpApplication` exposes a `draining` state; a small health module (inside `@blixis-io/health` or the security package; decide when X-6 lands) gives `/livez` (process is up) and `/readyz` (dependencies up and not draining). Readiness checks are registered by providers, not hard-coded.
4. Access log middleware: method, path (no query by default), status, latency, request id. No headers or bodies by default.

**Tests:** one request id appears in the access log and in the error report for a failing request; readiness flips during drain while liveness doesn't. Size M. Packages: http, events, (new) health.

#### X-11 Finish release hardening

Already in the working tree. Do not rewrite. Remaining after merging `ci/supply-chain-hardening`:
- coverage run once in CI (PERF-7), docs link check (DOC-1), automatic CI trigger for the Version Packages PR (CI-4);
- remove `NPM_TOKEN` plumbing from `release.yml` once OIDC is confirmed for every package (MNT-6) **[you]**;
- verify branch protection and npm account settings **[you]**; CI files prove neither.

### Phase 2: adoption

#### X-12 Fresh-install CI

A workflow job per OS (Ubuntu first, then macOS and Windows for the CLI packages): `pnpm pack` every publishable package; scaffold with `create-blixis` into a temp dir using those tarballs; install, build, run, probe with HTTP, send SIGTERM, assert exit 0 and that the shutdown hook ran; repeat with npm. Add `publint`/`attw` to check exports and types (MNT-8). Unsupported toolchains (an esbuild-based build that drops decorator metadata) must fail with a message that says what to change; check what `blix doctor` already reports before adding anything. Size M to L.

#### X-13 Stability policy and contribution guide

A docs page and root `STABILITY.md` or a section in the README: audience, supported Node (24+), what is stable, pre-1.0 rule (minor releases may break, always listed in the changelog), deprecation approach, a package compatibility table, a concrete 1.0 checklist, `CONTRIBUTING.md`. First check whether any of this already exists. Size S. Validate the one-line product message with real users before putting it on the landing page.

#### X-14 Reference application

A separate small example (name proposal: `examples/saas-api`; `hello-api` stays the minimal one). Scope is fixed: sign-in, refresh persistence (X-9 store), organizations/spaces/memberships, one tenant-scoped resource with a child, migrations, one transaction, error contract, OpenAPI with security, tests including denied cases, request-id logging, `/readyz`, Docker via `blix deploy`, and a README walkthrough. Anything beyond that is out. It is also the integration test for X-6 to X-10: if the example needs awkward code, the framework is wrong. Size L. Do after X-9 and X-10.

### Phase 3: only when needed

- **X-15 Outbox:** a worked example (own outbox table written in the same transaction, a poller that dispatches, idempotent consumers) inside the reference app, once something in it needs durability. No queue abstraction before that.
- **X-16 Database operations guide:** migration generation and ordering, never racing migrations across replicas at boot, pool sizing across replicas, query deadlines, transaction nesting.
- **X-17 Real-socket benchmark:** validation and auth on, tail latency, memory, cold start, environment recorded. Report it; do not set a CI budget until the noise is understood.
- **X-18 Property tests** for the router and parsers (TST-1). The router one is best done right after X-1.
- Deferred, unchanged: uploads, WebSockets, caching, more ORMs or runtimes, a Node-only entry split (decision already open in the TODO).

### Phase 4: API keys (machine credentials)

Added 2026-10-07 after the question "can API keys be protected: 2FA, IP ranges, anything else?". Today the framework has **no** API key feature: the guards guide shows one shared secret in an environment variable, and `@blixis-io/auth` only verifies signed JWTs (stateless, so not revocable). `@blixis-io/security` has `getClientIp` and `rateLimit` (which accepts a `key`) but no CIDR matching.

**Where it lives (decision D-9): inside `@blixis-io/auth`, not a new package.** An API key must resolve to the *same claims shape* as a JWT, so `Roles`, `createRolesGuard`, `getCurrentUser`, tenancy checks and the OpenAPI security description keep working unchanged. A separate package would need its own identity model or a dependency on auth's internals, and would split one concern (who is calling) across two packages. The CIDR helper is the one piece that is not about identity, so it goes in `@blixis-io/security` next to `getClientIp` (D-10). `auth` then depends on `security`; there is no cycle (`security` depends on `http`, not on `auth`). **No new package, so no npm placeholder or trusted-publisher step is needed**; if D-9 is reversed later, a new package would need both **[you]**.

#### X-19 CIDR matching in `@blixis-io/security`

`parseCidr` / `ipInCidrs(ip, cidrs)` for IPv4 and IPv6 (including IPv4-mapped IPv6 and `/0` to `/32`/`/128`), rejecting malformed input at construction time rather than silently matching nothing. **Tests:** property tests against a brute-force model (a CIDR matches exactly the addresses whose masked bits agree); hostile strings (leading zeros, `1.2.3.4/33`, `::ffff:` forms, zone ids). Size S.

#### X-20 API key guard in `@blixis-io/auth`

- Key format `blx_<id>_<secret>`: `id` is a lookup key, `secret` is at least 32 random bytes. Only a **SHA-256 of the secret** is stored (a slow password hash would make every request expensive for no gain on a high-entropy secret). Comparison is constant time. The secret is shown once, at creation.
- `ApiKeyStore` interface (`find(id)`, `touch(id, at)`, `revoke(id)`) implemented by the app, with a Postgres example like the refresh-token store. The guard fails closed: a store error is a 503, never an allow.
- Per key: `scopes`, `expiresAt`, `revokedAt`, optional `allowedCidrs`, `lastUsedAt` (best effort, never blocks a request).
- `defineAuthModule(...).forRoot({ apiKeys })` makes one module accept a Bearer JWT **or** an `x-api-key` header; a key resolves to the claims the store returns for it.
- An unknown id, a wrong secret, a revoked or expired key and a disallowed address all answer the same 401 with no hint which, and cost about the same time.
- Optional short in-process cache of positive lookups (default off), so revocation latency is a documented, bounded number.

**Tests:** wrong secret, truncated and oversized keys, revoked, expired, outside the allowed range, store failure (fail closed), timing equality between "unknown id" and "wrong secret" within a tolerance, a real Postgres store test. Mutation checks on the comparison and the CIDR gate. Size L.

#### X-21 Rate limits and scopes for keys

`rateLimit({ key })` per key id (an example, not new code), a `RequireScopes(...)` decorator and guard, and the reference app's use of both. Size S.

#### X-22 Operating keys: rotation, audit, docs

A guide: creating a key (show-once), rotating with overlap (two active keys per client), revoking, what to log (key id, never the secret; the access log must redact `x-api-key`), where 2FA belongs (on the human sign-in that creates or rotates a key, not on the key itself), and the proxy and `trustedProxyHops` setup an IP allowlist depends on. Update `protecting-routes-with-guards.md` to point at it. Size M.

**What this does not do, on purpose:** mTLS, request signing (HMAC) and OAuth client credentials are different mechanisms with their own trade-offs; none is planned until someone needs it.

## Decisions needed

| ID | Question | Recommendation |
| --- | --- | --- |
| D-1 | Middleware shape: one `middleware: []` option, or `app.use()`, or both? | The option only. Smaller, and order is visible in one place. |
| D-2 | Does the request context start outside the middleware? | Yes, so logs can carry a request id. |
| D-3 | How is the client IP exposed? | A field on `RequestContext` set by the Node adapter, plus `getClientIp()` honouring `trustProxy`. Decide before X-7. |
| D-4 | Grace window for double refresh? | Configurable, default off. |
| D-5 | A `shutdownHookTimeout`, or only documentation? | Document first; add only if someone hits it. |
| D-6 | Access-token revocation hook in the auth guard? | Not now. Document short TTLs. |
| D-7 | Security baseline: new package or inside `http`? | New package `@blixis-io/security` (already the TODO's recommendation). |
| D-8 | Health: its own package or part of security? | Own small package; liveness and readiness are not security. |
| D-9 | API keys: new package or inside `@blixis-io/auth`? | Inside `auth`: a key must resolve to the same claims as a JWT so roles, tenancy and OpenAPI keep working. |
| D-10 | Where does CIDR matching live? | `@blixis-io/security`, next to `getClientIp`; `auth` depends on `security`. |
| D-11 | Store only a SHA-256 of the key secret, or a slow password hash? | SHA-256: the secret is 32+ random bytes, and a slow hash would only cost every request time. |

## Sequence and dependencies

```
Phase 0:  X-1  X-2  X-3  X-4  X-5          (independent; X-1..X-4 first)
Phase 1:  X-6 ──> X-7 ──> (rate limit on auth routes)
          X-6 ──> X-10
          X-8, X-9, X-11                     (independent of X-6)
Phase 2:  X-12, X-13                         (any time after phase 0)
          X-14 needs X-9, X-10 (and X-7 for rate limits)
Phase 3:  X-15..X-18 as demand and measurements justify
Phase 4:  X-19 ──> X-20 ──> X-21 ──> X-22   (API keys; X-19 and the store interface can start any time)
```

## How we know it worked

The review's own outcome list, made testable:

1. Documented behaviour matches tests: each reproduced defect has a regression test, and the two false doc sentences are true.
2. Tenant boundaries survive hostile resource ids: the X-8 suite passes.
3. Refresh rotation survives concurrency and failure: the X-9 real-store tests pass.
4. Every request path has the same policy and diagnostics: the X-6 test lists 404, 405, 400, 403, 500, mounted and 504.
5. A fresh consumer install works on the CI matrix: X-12.
6. The reference app deploys and upgrades through a documented path: X-14.

## Risks and open questions

- Behaviour changes in X-1 (405 becomes a handler) and X-2 (504 now covers guards) are visible to existing apps. Both are bug fixes while 0.x; say so in the changesets.
- X-7 and X-10 add packages: each needs an npm placeholder and trusted publisher **[you]**, and npm's 24-hour re-publish rule has already cost time (events and testing, per memory notes). Create placeholders early.
- RLS (X-8) and the rate-limit store across replicas (X-7) are claims from the review that I have not tested. Treat them as hypotheses until their tests exist.
- The ChatGPT review looked at `HEAD` only. Re-diff its item 10 against the branch before starting X-11.
