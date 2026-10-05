# Code review: Blixis Framework

Reviewed 2026-10-05 against `main` at `9c4358a` (PR #72). Two PRs were still open and are **not** covered in depth: #73 (request-path docs) and #74 (`blix run` provides `RequestContext`, hello-api command and listener example). Both have since merged and shipped; see [Status since the review](#status-since-the-review). All numbers below are from `9c4358a` unless stated.

## How to read this

Scope: all 16 packages under `packages/` (about 7,700 lines of source, 11,600 lines of tests), `examples/hello-api`, the three GitHub workflows, repo config and the docs site (structure and links, not prose).

Every finding carries a status tag, so you can tell what was proven from what was reasoned:

| Tag | Meaning |
| --- | --- |
| **[R]** | Reproduced: I ran code or a command and saw the failure. |
| **[V]** | Verified by reading the code and by tool output (coverage, lint, audit, duplicate scan). |
| **[S]** | Suspected: reasoned from the code, not run. Treat as a lead. |

Severity: **High** (can take a service down or leak data), **Medium** (wrong behaviour or real risk under plausible use), **Low** (rough edge, cosmetic or hardening), **Info** (trade-off to be aware of).

No Critical findings. The core is in good shape: strict TypeScript, 99% line coverage, tests against a real Postgres, almost no copy-pasted code, and thoughtful security basics. The problems cluster in **operational edges** (what happens when a database connection drops, a hook fails, or a request is slightly unusual) and in **supply-chain hygiene**.

## Status since the review

Updated 2026-10-05, after the release. Fixed so far: MNT-1 (#76, released in #77), REL-1 and REL-4 (#79), REL-2 and REL-3 (#81, #79 and #81 released in #80), BUG-1 and BUG-2 (#83, released in #84), BUG-4, SEC-11, BUG-8 and DRY-7 (#85, released in #86), BUG-3 and BUG-7 (#87, in release PR #89), SEC-2 and SEC-10 (#88, released in #89), SEC-1 and SEC-6 (#90, released in #91), BUG-5, PERF-1 and SEC-8 (#92, released in #93), BUG-6 (item-9 PR); the rest are scheduled in [`TODO.tmp.md`](./TODO.tmp.md) section 0 (P1 onwards), in the order of the agenda at the end of this file.

| Item | Status |
| --- | --- |
| #73 request-path docs | Merged. |
| #74 `blix run` provides `RequestContext`, hello-api command and listener | Merged. Tests on `main` are now **936** (927 at review time). |
| Release #70 | Merged and published: commands 0.2.0, http 0.5.0, cli 0.4.1, auth 0.2.1, openapi 0.2.5, tenancy 0.1.6, testing 0.1.6. All seven confirmed on the registry. |
| Fresh install, published versions, with `@blixis-io/http` | Built and ran: `blix run`, `blix run ping` (a command injecting `RequestContext`, which read empty), `blix doctor` clean, one copy each of core and di. Closes the "not verified" caveat on #74. |
| Fresh install, published versions, without `@blixis-io/http` | Built and ran `blix run hello`. The optional peer import fails quietly as designed. |
| MNT-1 (peer dependencies) | **Fixed in #76, released in #77** (core 0.4.0, http 0.6.0, auth 0.3.0 and others; confirmed on the registry): `core`, `di`, `http`, `zod`, `drizzle-orm` are now peers; verified with packed tarballs and then against the real registry in fresh pnpm and npm installs (missing peers auto-installed, one copy each), plus a Changesets dry run. A real mismatch (auth 0.3.0 with core 0.3.1) is refused by npm (`ERESOLVE`) but only warned about by pnpm 11, so a `blix doctor` check for unmet peer ranges was added to the agenda (TODO P1 item 12). One correction to the finding as written: the DI/core `DuplicatePackageError` import-time guard already turned the two-copies case into a loud failure when both copies include it, so the bug was less silent than "breaks at runtime" suggests; the pins still forced every user to upgrade in lockstep. |
| REL-1, REL-4 (db pool) | **Fixed in #79** (db minor, in release PR #80). Reproduced first with a pool built like `DbConnection`, then on the built package: killing the idle backend exited the original with `Unhandled 'error' event`; the fix stays alive and the next query works. `onPoolError` option, 10 s default connection timeout. Real failover not tried. |
| REL-2, REL-3 (core lifecycle) | **Fixed in #81** (core patch, di patch, in release PR #80). `close()` runs every hook and aggregates failures; a failed boot shuts down what it built. With a real pool the process outlived a failed boot by 10,044 ms before and 72 ms after. |
| BUG-1, BUG-2 (router) | **Fixed in #83** (http patch). Per-route param names, segments decoded once, broken escape is a 400. Reproduced first on a real socket; the original handed a DELETE route `null` for `postId` and left every param encoded. |
| BUG-4, SEC-11, BUG-8, DRY-7 (http origin, media type, challenge, titles) | **Fixed in the item-4 PR** (http minor, auth minor, peer-range minors for openapi/tenancy/testing). Reproduced first on a real socket: the original reported `http://127.0.0.1:0/...`, titled a 429 as "Error", sent no `Retry-After` or `WWW-Authenticate`, and accepted `application/jsonp`. Not tried behind a real proxy. |
| BUG-3, BUG-7 (prototype keys, generator names) | **Fixed in the item-5 PR** (cli patch, deploy patch). Built-CLI before/after: `blix constructor` said it "needs undefined", `blix g constructor users` crashed with `Unreachable: unknown generator type function Object() { [native code] }`, `blix g c 123` wrote `export class 123Controller`, `blix g c café` wrote `src/caf/`; all now refused with a message. `blix add constructor` (original: `npm install -D undefined`) is covered by a test, not run for real. |
| SEC-2, SEC-10 (auth hardening) | **Fixed in #88** (auth minor, two breaking changes: a minimum secret length and a required `exp`). Built-package before/after: `secret: "short"` accepted then refused; a token with no `exp` accepted then 401; `bearer` was 401 then accepted; a hash asking for 2 GiB computed for 2.9 s then refused in 1 ms. |
| SEC-1, SEC-6 (deploy) | **Fixed in the item-7 PR** (deploy minor). Built-package before/after: `vercel@latest` became `vercel@62.2.0` and `init` writes it into the config; a docker target with `pussh: false` was built and pushed, and is now refused with `did you mean "push"?`. The three pinned versions exist, are not deprecated and allow Node 24, but no real deployment was run. |
| BUG-5, PERF-1, SEC-8 (logging) | **Fixed in the item-8 PR** (logging minor). Built-package before/after: an error with a code logged as `{"code":"ECONNREFUSED"}` with no message, and a circular or `BigInt` context was replaced by a `transport failed` note; the fix writes message and stack and all three entries. Disabled `debug` call 98 ns to 9 ns. `redact` is opt-in on purpose. |
| BUG-6 (openapi) | **Fixed in the item-9 PR** (openapi patch). Real-socket before/after: `/openapi.json` answered 500 for an app with a `z.date()`; it answers 200 with `date-time`, optional defaulted request fields and the query parameters of a `.transform()`-wrapped schema. One visible difference: no `additionalProperties: false` on a non-strict request body. |
| New observation for MNT-1 (before the fix) | `commands@0.2.0` declares its peers with caret ranges (`@blixis-io/http ^0.5.0`, optional), the right shape; `auth` and its siblings still pin exact versions (`core 0.3.1`, `di 0.1.2`, `http 0.4.0` seen on the registry before this release). |
| Known friction | Within 24 h of a release, `pnpm exec` also fails the `minimumReleaseAge` check, not just `install`, so users adding the new versions need `minimumReleaseAgeExclude: ["@blixis-io/*"]`. Already documented; recorded as a lesson in the TODO. |

Not reviewed in depth: the code added by #74 (`bootApplication` wrapping in `commands/src/plugin.ts`, the exported `RequestContextModule`, the hello-api example). It has its own tests and the real-install checks above, but no review pass against the categories in this document.

## Summary

| Area | Verdict | Headline |
| --- | --- | --- |
| Security | Good basics, gaps at the edges | No injection or traversal found. Weak spots: provider CLIs run as `@latest` with deploy tokens, JWT verify is permissive, workflow actions pinned by tag, no CORS/rate-limit story. |
| Correctness | A few real bugs | Router silently mis-binds params, never percent-decodes, `request.url` has the wrong host. `blix add constructor` runs `npm install -D undefined`. |
| Reliability | One High | An idle Postgres connection dropping **crashes the process** (reproduced). Failed boot and failed shutdown hooks leave resources open. |
| Performance | Healthy hot path | 0.3 µs per route match, 5 to 24 µs per request in-process. A few cheap wins (logging, boot, CI runs tests twice). |
| DRY | Very good | 0.12% exact duplication. Real duplication is conceptual: package-manager knowledge in 5 places, three argument parsers, three process spawners. |
| Testing | Strong, with holes | 99.1% lines, 95.2% branches, 927 tests. Gaps: no fuzz/property tests, no benchmarks, 39 timer-based tests, CLI branch coverage 85.7%. |
| Maintainability | Good, one structural issue | `core`, `di`, `http`, `zod`, `drizzle-orm` are regular dependencies of the packages that build on them, which invites the duplicate-copy bug `blix doctor` exists to catch. |

### Top 12, in the order I would fix them

1. **REL-1** (High, [R]) `@blixis-io/db`: no `pool.on("error")`. Killing one idle connection crashes the app.
2. **REL-3** (Medium, [R]) `close()` stops at the first failing shutdown hook, so a failing flush can skip closing the database pool.
3. **REL-2** (Medium, [R]) A failed boot runs no shutdown hooks, so earlier providers leak.
4. **BUG-1** (Medium, [R]) Routes `GET /posts/:id` and `DELETE /posts/:postId` register, but the second handler silently gets no `postId`.
5. **SEC-1** (Medium, [V]) Provider CLIs run as `npx --yes <cli>@latest` with deploy tokens in the environment.
6. **SEC-2** (Medium, [V]) JWT verification: no minimum secret length, `exp` not required, no issuer/audience, `Bearer` is case-sensitive.
7. **MNT-1** (Medium, [V]) Library packages depend on `core`/`di`/`http`/`zod` instead of peering them.
8. **BUG-4** (Medium, [R]) `request.url` is `http://127.0.0.1:0/...` when listening on port 0, and never reflects the `Host` header.
9. **BUG-5** (Medium, [V]) Logging an `Error` in the context prints `{}`; a circular object drops the whole line.
10. **SEC-6** (Medium, [V]) Deploy config schemas strip unknown keys, so a typo such as `pussh: false` silently leaves `push: true`.
11. **CI-1** (Medium, [V]) Every GitHub Action is pinned by tag; the release job holds `contents: write` and `id-token: write`. No Dependabot, no audit gate.
12. **BUG-6** (Medium, [R]) `@blixis-io/openapi` throws on `z.date()` or any transform, taking down the whole document.

## Metrics

### Size and tests

| Package | Source lines | Test lines | Test:source |
| --- | --- | --- | --- |
| http | 1,365 | 3,296 | 2.4 |
| deploy | 1,425 | 1,502 | 1.1 |
| cli | 913 | 933 | 1.0 |
| di | 650 | 899 | 1.4 |
| core | 407 | 876 | 2.2 |
| auth | 599 | 806 | 1.3 |
| commands | 370 | 482 | 1.3 |
| events | 168 | 441 | 2.6 |
| db | 213 | 417 | 2.0 |
| logging | 179 | 346 | 1.9 |
| method-hooks | 141 | 343 | 2.4 |
| openapi | 229 | 335 | 1.5 |
| create-blixis | 381 | 297 | 0.8 |
| tenancy | 179 | 272 | 1.5 |
| testing | 80 | 140 | 1.8 |
| config | 51 | 93 | 1.8 |
| hello-api (example) | 310 | 101 | 0.3 |

Source lines exclude tests and fixtures. hello-api is measured before #74.

### Coverage (`pnpm run test:coverage`, v8)

| Metric | Result | Gate |
| --- | --- | --- |
| Lines | 99.10% | 90% (enforced in CI) |
| Branches | 95.18% | 90% (enforced in CI) |
| Statements | 99.04% | none |
| Functions | 99.61% | none |

Per-package branch coverage is lowest in `cli` (85.65%, `doctor.ts` 81.71%), `commands` (91.61%), `tenancy` (94.73%) and `events` (95.23%). The text report hides fully covered files, so the list of files below 100% is short and specific:

- `cli/doctor.ts` lines 139, 143, 156, 222 and several branches (tsconfig edge cases, JSONC parsing).
- `deploy/runner.ts` lines 29 to 50: the real `spawn` wrapper, covered only by mocks elsewhere (branch 83%).
- `commands/plugin.ts` lines 43 to 46, 72, 86; `commands/run.ts` lines 52, 140.
- `http/fetch-handler.ts` (one function), `http/handler.ts` line 237.

Coverage is a global gate only, and `index.ts` files and `examples/` are excluded. There are 24 `/* v8 ignore */` blocks, each with a written reason. One is now stale (see TST-3).

### Other measurements

| Check | Result |
| --- | --- |
| Exact duplicate code (`jscpd`, 8 lines / 70 tokens) | 1 clone, 9 lines, 0.12% |
| Looser scan (5 lines / 40 tokens) | 6 small clones, none material |
| Lint (`oxlint --type-aware`) | 0 errors, 9 warnings, all `no-await-in-loop` and all intentional (sequential order matters) |
| `pnpm audit` | 1 high advisory (`http-cache-semantics`, GHSA-ch52-4w7c-c8xp, patched in 4.3.0), reached only through `docs>astro`. Not in any published package. |
| Internal doc links | 293 checked, 1 broken anchor (`concepts/response-validation.md` to `examples/cookbook/#returning-a-raw-response`) |
| Type escape hatches | 3 `as never` / `as unknown as`, 6 `@ts-*` / lint suppressions, `no-unsafe-type-assertion` switched off in 15 files |

### Performance (in-process, vitest on Node 24.21, Apple M1 Pro)

Indicative only: no socket, vitest transform overhead included, no warm-up beyond 2,000 calls.

| Operation | Throughput | Per call |
| --- | --- | --- |
| `Router.match`, 200 routes, param route | 3.6 M/s | 0.3 µs |
| Handler `GET /items` (no schema) | 204 k/s | 4.9 µs |
| Handler `GET /items/:id` with `@Returns` validation | 124 k/s | 8.1 µs |
| Handler `POST /items` (JSON body + Zod) | 42 k/s | 23.8 µs |
| Handler 404 | 105 k/s | 9.6 µs |
| Real socket, 16 concurrent `fetch` in the same process | about 6 k req/s | client-bound |

The framework adds well under 25 µs per request; a database call will dwarf it. The socket figure measures `fetch`/undici in the same process, not the server, so it says nothing about server capacity. A 404 costs more than a successful `GET` because it builds a problem+json response.

## Findings

### Security

| ID | Sev | Status | Finding |
| --- | --- | --- | --- |
| SEC-1 | Medium | [V] | **Fixed in the item-7 PR (pinned defaults, written by `init`, shown and warned about by `doctor`; the versions are not tested against real deployments).** **Provider CLIs run unpinned with credentials.** `cliVersion` defaults to `"latest"` (`deploy/src/config.ts:37`) and the step is `npx --yes <cli>@latest deploy` with `VERCEL_TOKEN`, `NETLIFY_AUTH_TOKEN` or `CLOUDFLARE_API_TOKEN` in the environment (full `process.env` is passed through, `deploy/src/runner.ts:24`). A compromised release of any of those CLIs runs with your deploy token. Fix: default to a tested pinned version, bump it deliberately, keep `latest` as opt-in. Already on the TODO as "consider pinning". |
| SEC-2 | Medium | [V] | **Fixed in #88 (secret length, required `exp`, `issuer`/`audience`, case-insensitive `Bearer`).** **JWT verification is permissive** (`auth/src/module.ts:139`). (a) No minimum secret length: `secret: "x"` is accepted for HS256. (b) `jwtVerify` is not told to require `exp`, so a token signed with the secret but carrying no expiry never expires. (c) No `issuer`/`audience` options, so two environments sharing a secret accept each other's tokens. (d) `startsWith("Bearer ")` (line 132) rejects `bearer x`, though RFC 7235 makes the scheme case-insensitive. Fix: require 32+ bytes, pass `requiredClaims: ["exp"]`, add optional `issuer`/`audience`, match the scheme case-insensitively. |
| SEC-3 | Medium | [V] | **Workflow actions pinned by tag, not commit SHA.** `actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v6`, `changesets/action@v1` and others. `release.yml` holds `contents: write`, `pull-requests: write` and `id-token: write`, so a retagged action could publish to npm. The generated deploy workflows (`deploy/src/ci.ts`) have the same tag pinning. |
| SEC-4 | Low | [V] | **No automated dependency or advisory hygiene.** No `dependabot.yml` or Renovate, no `pnpm audit` or dependency-review step in CI, no CodeQL, no `SECURITY.md`. The one current advisory is docs-only, but nothing would flag a runtime one. |
| SEC-5 | Medium | [V] | **No CORS, security headers, rate limiting or trusted-proxy handling.** Nothing in `packages/*/src` handles them, and docs mention none beyond a reverse proxy. A browser client on another origin cannot call a Blixis API without hand-written headers; sign-in (`auth`) has no throttle or lockout; behind a proxy, client IP and scheme are unknowable. This is a missing capability, not a bug. |
| SEC-6 | Medium | [V] | **Fixed in the item-7 PR (strict schemas with a "did you mean" hint).** **Deploy config silently ignores unknown keys.** Zod object schemas default to stripping (`deploy/src/config.ts:13` onward). `{ type: "docker", pussh: false }` parses, `push` defaults to `true`, and the image is pushed. Use `.strict()` so a typo is an error. |
| SEC-7 | Low | [V] | **`serveOpenApi` is public by design** (`HttpApplication.mount` bypasses guards). It is documented, but on an authenticated API the full route and schema inventory is exposed unless the user mounts it differently. Consider a `guard` option or a warning when `protectAllRoutes` is on. |
| SEC-8 | Low | [V] | **Fixed in the item-8 PR (opt-in `redact`).** **No log redaction.** Anything in a log context is written verbatim (passwords, tokens, `Authorization`). A `redact: ["password", "token"]` option on `createLogger` would be cheap insurance. |
| SEC-9 | Low | [V] | **`listen()` binds `0.0.0.0` by default** (`http/src/http-application.ts`). Convenient in containers, surprising on a laptop. Document it, or default to loopback outside `NODE_ENV=production`. |
| SEC-10 | Low | [V] | **Fixed in #88 (limits checked before any work).** **Argon2 parameters come from the stored hash** (`auth/src/password.ts`, `verifyPassword`). `m=` and `t=` are unbounded, so a corrupted or attacker-writable hash column can request gigabytes. Cap them to a sane maximum. |
| SEC-11 | Low | [V] | **Fixed in the item-4 PR.** **Content type check is a prefix match** (`http/src/handler.ts:148`): `application/json-patch+json` and `application/jsonp` pass as JSON. Compare the media type exactly (and accept `+json`, if intended). |
| SEC-12 | Info | [V] | **Trust model of the CLI.** `blix` imports `blix.config.ts` and resolves plugins from the project's `node_modules`, so running any `blix` command in an untrusted checkout executes that checkout's code (same class as `npm run`). Worth one sentence in the docs. |

Checked and fine: path handling in `blix generate` (names are reduced to `[a-z0-9-]`, so no traversal), `create-blixis` (target directory name validated, writes confined), all `spawn` calls (argument arrays, shell only for the user's own `build`/`after` commands and on Windows), registry password sent over stdin never argv, argon2id with timing-safe compare and a dummy-hash path so unknown accounts cost the same as real ones, refresh-token rotation with reuse detection and an atomic `markRotated`, 500 responses never echo internal messages, request-body size enforced while streaming.

### Correctness bugs

| ID | Sev | Status | Finding |
| --- | --- | --- | --- |
| BUG-1 | Medium | [R] | **Fixed in #83.** **Router mis-binds params across methods.** `Router.add` keeps the first param name for a path position (`http/src/router.ts:106`, `paramChild ??=`). With `GET /posts/:id` and `DELETE /posts/:postId`, the DELETE handler receives `{ id: "5" }` and `@Param("postId")` is `undefined`, with no error at registration. Same-method duplicates are caught, this case is not. Fix: throw at registration when the param name at a position differs. |
| BUG-2 | Medium | [R] | **Fixed in #83 (decoding and the 400; `//` and trailing slashes kept tolerant on purpose).** **Path params are never percent-decoded.** `GET /posts/hello%20world` gives `id = "hello%20world"` (`handler.ts:264` matches on `URL.pathname`, which stays encoded). Routes also match `//posts//5/` (empty segments are dropped). Decode each segment once at match time, and decide whether non-canonical paths should 404. |
| BUG-3 | Low | [R] | **Fixed in the item-5 PR (`Object.hasOwn` at six sites; two more were found than listed here: `selectTarget` and the `in` check in the CLI dispatch).** **User input indexes plain objects, so prototype keys resolve.** `KNOWN_PLUGINS[name]` (`cli/src/plugins.ts:44`, `cli/src/add.ts:21`), `ALIASES[input]` (`cli/src/templates.ts:23`), `PROVIDERS[id]` (`deploy/src/ci.ts:197`). Reproduced: `blix add constructor` ran `npm install -D undefined` and printed `Added undefined.`; `blix toString` reports "not installed" with no package name. Use `Object.hasOwn` or a `Map`. |
| BUG-4 | Medium | [R] | **Fixed in the item-4 PR (bound port, IPv6 brackets, opt-in `trustHostHeader`/`trustProxy`).** **`request.url` has the wrong origin.** The Node adapter builds it from the listen address (`http-application.ts:93`). With `listen(0, "127.0.0.1")` a handler sees `http://127.0.0.1:0/u` even when a `Host: api.example.com` header was sent. Anything that builds absolute URLs (redirects, `Location`, OpenAPI `servers`, signed links) gets it wrong. Build from the `Host` header (with a trusted-proxy option) or document the limitation. |
| BUG-5 | Medium | [V] | **Fixed in the item-8 PR.** **Errors vanish from log context.** `JSON.stringify({ err: new Error("x") })` is `{"err":{}}` (`logging/src/transports/console.ts:21`), so `log.error("failed", { err })` loses the message and stack. A circular object or `BigInt` makes `JSON.stringify` throw; the logger catches it and reports "a transport failed", dropping the original line. Add an error-aware, cycle-safe serializer. |
| BUG-6 | Medium | [R] | **Fixed in the item-9 PR.** **OpenAPI generation throws on common schemas.** Reproduced against zod directly (the generator has no `try/catch` around it, from reading): `z.toJSONSchema` raises "Date cannot be represented" for `z.date()` and "Transforms cannot be represented" for any `.transform()` (`openapi/src/generate.ts:68`), so `/openapi.json` fails for the whole app. Also request bodies use the default (output) shape, so a field with `.default(5)` is documented as required although the client may omit it; request schemas should use `{ io: "input" }`. Also `instanceof z.ZodObject` (line 107) silently skips query docs if the app's zod is a different copy (see MNT-1). |
| BUG-7 | Low | [R] | **Fixed in the item-5 PR (one `parseName`).** **`blix g c 123` generates invalid TypeScript** (`export class 123Controller`). Names that start with a digit need a prefix or an error. Non-ASCII is dropped silently (`Ünïcode` becomes `n-code`), and `---` is read as a flag. |
| BUG-8 | Low | [V] | **Fixed in the item-4 PR.** **401 responses lack `WWW-Authenticate`** (required by RFC 9110 for 401), and the problem+json title map (`http/src/handler.ts:169`) lacks 422, 429, 503 and others, so a custom `HttpException(429)` is titled "Error". |
| BUG-9 | Low | [V] | **Repeated query keys collapse.** `Object.fromEntries(searchParams)` keeps the last value, so `?role=user&role=admin` is `admin` and arrays are impossible to express. Document it or support repeated keys. |
| BUG-10 | Low | [S] | **`@OnEvent` can subscribe twice.** `handlersOf` walks the prototype chain and concatenates records, so a subclass that re-decorates an overridden method gets two entries for one method (`events/src/module.ts`). Not reproduced. |
| BUG-11 | Low | [V] | **`TenantScopedGuard` on a route without `:spaceId` fails at request time** with a plain `Error` (a 500, `tenancy/src/module.ts:93`) instead of at boot, when the route table is known. |
| BUG-12 | Low | [V] | **`http` server `error` after start is unhandled** (`http-application.ts:112` uses `once`). An `EMFILE` or similar later becomes an uncaught exception. |
| BUG-13 | Low | [V] | One broken doc anchor (`response-validation.md` to `cookbook/#returning-a-raw-response`); `relativeName` in `deploy/src/config.ts` uses a character class with a duplicated backslash (works, reads like a mistake). |

### Reliability

| ID | Sev | Status | Finding |
| --- | --- | --- | --- |
| REL-1 | **High** | [R] | **Fixed in #79.** **A dropped idle Postgres connection crashes the process.** `DbConnection` creates `new Pool(...)` with no `pool.on("error", ...)` (`db/src/drizzle/module.ts:34`). `pg` re-emits an idle client's error on the pool; with no listener Node throws `Unhandled 'error' event`. Reproduced with a pool built the same way: terminating the idle backend (what a database restart, failover or `pg_terminate_backend` does) killed the process. Fix: attach a listener that logs through the injected `LOGGER`; add a test that terminates a backend. |
| REL-2 | Medium | [R] | **Fixed in #81.** **A failed boot runs no shutdown hooks.** If a provider's `onModuleInit` throws, providers built earlier are never closed (`core/src/application.ts:217` to `232`; reproduced: shutdown hook of an earlier provider did not run). Matters for `createFetchHandler`, which retries boot on the next request: each failed attempt can leave a pool behind. Fix: on boot failure, run shutdown hooks for what was constructed, in reverse order, then rethrow. |
| REL-3 | Medium | [R] | **Fixed in #81.** **`close()` stops at the first failing hook** (`application.ts:256` loop has no `try/catch`). Reproduced: a dependent's shutdown hook throws, the pool it depends on is never closed. Run every hook, collect errors, throw an `AggregateError` at the end. |
| REL-4 | Medium | [V] | **Fixed in #79 (connection timeout; `max` and `statement_timeout` documented, not defaulted).** **No pool limits or timeouts by default.** `pg.Pool` waits forever for a free client (`connectionTimeoutMillis` 0), and there is no `statement_timeout`. When the pool is exhausted, requests hang until the client gives up, and `requestTimeout` only returns 504 while the work keeps waiting. Ship a safe default (for example 5 s connect timeout) and document `max`. |
| REL-5 | Low | [V] | **Event handler failures are invisible to the emitter.** `emit` resolves normally when listeners throw and logs via `console.error` (`events/src/module.ts:62`), bypassing the app logger. Callers cannot tell, and operators lose structured logs. At minimum use the injected logger. |
| REL-6 | Low | [V] | **`createFetchHandler` boots lazily**, so cold-start latency lands on the first user request (and all `onModuleInit` hooks run serially, see PERF-3). Fine for servers; for serverless consider an explicit warm-up hook. |

### Performance

| ID | Sev | Status | Finding |
| --- | --- | --- | --- |
| PERF-1 | Low | [V] | **Fixed in the item-8 PR (98 ns to 9 ns per disabled call).** **Logger builds the merged context before checking the level.** `{ ...boundContext, ...context }` runs on every call (`logging/src/logger.ts:52`), including disabled `trace`/`debug` calls. Check `isLevelEnabled` first. |
| PERF-2 | Low | [V] | **Async-schema response validation parses twice.** `parse()` tries `safeParse`, catches `$ZodAsyncError`, then runs `safeParseAsync` (`http/src/response.ts`). Cache "this schema is async" per route after the first request. |
| PERF-3 | Low | [V] | **`onModuleInit` hooks run strictly one after another** (`core/src/application.ts:223`). Boot time is the sum of every provider's init. Providers at the same dependency depth could initialise concurrently. Matters most for serverless cold starts. |
| PERF-4 | Low | [V] | **Each `@Query` parameter re-parses the URL** (`http/src/params.ts`, per-parameter `new URL` and `Object.fromEntries`). Parse once per request. |
| PERF-5 | Low | [V] | **`@Transactional` scans `Object.values(instance)` on every call** to find the database (`db/src/drizzle/transactional.ts`, `findRunner`). Cache per instance in a `WeakMap`. |
| PERF-6 | Info | [V] | **The default response validation re-serialises every `@Returns` response** (about 3 µs extra on a small object). Intentional (it strips unknown keys and prevents leaks); the option to turn it off exists. |
| PERF-7 | Low | [V] | **CI runs the test suite twice.** `pnpm run ci` runs `turbo test`, then `test:coverage` runs everything again. Run coverage once and gate on it. |
| PERF-8 | Info | [V] | **No benchmarks and no performance budget** anywhere in the repo. The numbers above are one-off. |

### DRY

Exact duplication is negligible (0.12%). The duplication that exists is conceptual: the same knowledge held in several places.

| ID | Sev | Finding |
| --- | --- | --- |
| DRY-1 | Medium | **Package-manager knowledge in five places.** `cli/src/pm.ts` (detect, add args), `create-blixis/src/index.ts:50` (`addArgs`, `execBlix`, detect by user agent), `deploy/src/ci.ts:25` and `:96` (two tables, each with install and exec per manager), `deploy/src/dockerfile.ts`. Adding a manager, or fixing `yarn` flags, means touching all of them. Centralise `install`, `exec`, `add` per manager in `cli/pm.ts` and reuse it. |
| DRY-2 | Low | **Three process spawners.** `cli/src/add.ts:9`, `create-blixis/src/index.ts:123` (identical, including the Windows `shell` branch) and `deploy/src/runner.ts`. |
| DRY-3 | Low | **Three hand-written argument parsers** (`deploy/src/commands.ts`, `create-blixis/src/index.ts`, `cli/src/bin.ts`) next to `util.parseArgs` in `commands/src/run.ts`. One approach would give consistent `--flag=value` and error handling. |
| DRY-4 | Low | **Per-`define*Module` context-key counter copied** (`auth/src/module.ts:96`, `tenancy/src/module.ts:49`), each with its own `get/set` accessors. A `defineContextKey<T>()` helper in `http` would remove it and the class of bug the comment describes. |
| DRY-5 | Low | **Role checks written twice** in `auth/src/module.ts`: `rolesOf` + `isStringArray` in `AuthGuard`, and an inline cast at line 216 in `createRolesGuard`. `JwtAuthGuard` and `AuthGuardImpl` also repeat the same constructor and `authenticate` call. |
| DRY-6 | Low | **Deploy `init` and `ci` build the same render options twice** (`deploy/src/commands.ts`, `runInit` and `runCi`), with `nodeVersion: "24"` hard-coded in both (lines 244 and the `runCi` copy). `CONFIG_NAMES` (line 168) repeats `CONFIG_FILES` from `cli/src/config.ts` (not exported from the package index, so deploy cannot reuse it yet). |
| DRY-7 | Low | **Fixed in the item-4 PR (one table of registered reason phrases).** **Problem+json titles are a second source of truth.** `STATUS_TITLES` (`http/src/handler.ts:169`) mirrors the exception classes. Derive the title from the exception or from one shared table (also fixes BUG-8). |
| DRY-8 | Low | **Test and CI plumbing repeated.** The Postgres connection string is hard-coded in three test files plus the example (`tenancy/src/scope.test.ts:9`, `db/src/drizzle/module.test.ts:6`, `db/src/drizzle/transactional.test.ts:9`); the Postgres service block is copied into three workflow jobs; `vitest.shared.ts` keeps a hand-written alias list for 13 packages while `commands`, `deploy` and `create-blixis` are not in it. |

### Testing

| ID | Sev | Finding |
| --- | --- | --- |
| TST-1 | Medium | **Hand-written parsers have no property or fuzz tests.** The router, the JSONC stripper in `cli/doctor.ts` (also the least-covered file, 81.7% branches), the PHC password-hash parser and the YAML/Dockerfile renderers are exactly where fuzzing finds what example tests miss. BUG-1 and BUG-2 are the kind of thing a router property test ("param names are consistent", "decode then match") would have caught. |
| TST-2 | Medium | **No test for the High finding's scenario.** Nothing kills a pooled connection (REL-1), fails a shutdown hook after a dependent (REL-3), or fails boot midway (REL-2). Each is a small test. |
| TST-3 | Low | **A coverage exclusion is now stale.** The `listen()` safety-net `catch` in `http-application.ts:96` is marked "not reliably reproducible"; since #69 there are real-socket disconnect tests and it can be covered. Re-check each of the 24 `v8 ignore` blocks occasionally. |
| TST-4 | Low | **Timing-based tests.** 39 `sleep`/`setTimeout` uses in tests; several of my own recent ones rely on 60 to 250 ms windows (`request-context-sockets.test.ts`). They passed 5 of 5 locally and in CI, but a loaded runner could flake them. Prefer deterministic gates (latches, `vi.useFakeTimers`) where the window is not the thing under test. |
| TST-5 | Low | **Linux-only CI.** The `compat` matrix varies Node (24, latest) but not OS. `shell: process.platform === "win32"` branches, path handling in the CLI and `create-blixis` are untested on Windows and macOS. |
| TST-6 | Low | **Coverage is gated globally (90%) only.** `cli` can drop to 85% branches without failing. A per-package floor, or `perFile`, would stop a quiet slide. Functions and statements are not gated. |
| TST-7 | Info | **No type-level tests.** The typed `@OnEvent`, `defineEventsModule` and `@Returns` rely on compile errors for wrong usage, but nothing asserts those errors keep happening (`expectTypeOf` or `@ts-expect-error` fixtures). |
| TST-8 | Info | **Never exercised against reality** (already tracked): real registry push, generated workflows on GitHub/GitLab/Bitbucket, real `vercel`/`netlify`/`wrangler` deploys, Bun/Deno/Workers for the fetch handler beyond one Bun spot-check. |

### Maintainability

| ID | Sev | Finding |
| --- | --- | --- |
| MNT-1 | **Medium** | **Fixed in #76.** **Singleton-sensitive packages are pinned, regular dependencies.** `auth`, `config`, `db`, `events`, `logging`, `openapi`, `tenancy`, `testing` and `http` list `@blixis-io/core`, `@blixis-io/di` (and `http`) under `dependencies`; `http`, `auth`, `config` and `openapi` do the same with `zod`, and `db`/`tenancy` with `drizzle-orm`. The workspace protocol publishes these as **exact versions**: `npm view @blixis-io/auth dependencies` shows `@blixis-io/core: 0.3.1`, `@blixis-io/di: 0.1.2`, `@blixis-io/http: 0.4.0` (checked on the registry). So the moment `core` is patched to 0.3.2 and an app upgrades it, every library package still pulls its own pinned `core 0.3.1`, and the app gets **two copies**. That breaks DI metadata and module identity (`NotAModuleError`), the exact failure `blix doctor` was built to detect. The same applies to Zod: `instanceof z.ZodObject` (openapi) and `z.core.$ZodAsyncError` (http) fail across copies. `commands` and `deploy` already use peers, so this is also inconsistent. Make `core`, `di`, `http`, `zod` and `drizzle-orm` peer dependencies of the packages that extend them (keep them as dev dependencies for the monorepo). [decide] |
| MNT-2 | Medium | **Import-time side effects.** `ConfigModule.forRoot()` validates `process.env` the moment it is called inside an `@Module({ imports: [...] })` array (`config/src/module.ts:24`), so merely importing `AppModule` (for `blix run`, `blix doctor`, OpenAPI generation or tests) requires a complete environment. Prefer deferring validation to boot, or document the constraint. |
| MNT-3 | Low | **Logging bypasses the logger.** `console.error` in `http/src/handler.ts:198` (unexpected 500s, with no method, path or request id), `http/src/fetch-handler.ts:40`, `http/src/http-application.ts:103`, `events/src/module.ts:62`. The one place operators most need structured logs, unexpected errors, is unstructured and uncorrelated. |
| MNT-4 | Low | **Type-safety escape hatches add up.** `no-unsafe-type-assertion` is disabled in 15 files, 24 coverage ignores, 3 `as never`. Each has a reason, but the list only grows; revisit when touching those files. |
| MNT-5 | Low | **`TODO.tmp.md` and `HANDOVER.md` live at the repo root and drift.** Section 0 of the TODO still described a merged PR as open and an old `main` SHA. Stale status in files agents read first is a hazard. Keep one source of truth, or generate the status from `git`/`gh`. |
| MNT-6 | Low | **Stale release plumbing.** `release.yml` still passes `NPM_TOKEN` and carries a long comment about the token fallback, though the secret was deleted and publishing is via OIDC. Remove it once Trusted Publishing is confirmed for every package. |
| MNT-7 | Low | **Stray `packages/plugins/`** exists locally with only an ignored `.turbo` directory. Harmless, but it shows up in `ls packages` and counts as a package folder with no README. |
| MNT-8 | Low | **No public-API guard.** Exports are curated by hand in each `index.ts`. A `publint`/`attw` check and an API report (api-extractor or a snapshot of exports) would turn an accidental breaking change into a failing check. |
| MNT-9 | Info | **Node 24 only** (`engines >=24`, CI Node 24 and latest). Deliberate (native TS stripping for config, `crypto.argon2`), but a real adoption limit worth stating on the landing page. |
| MNT-10 | Info | **Comment density is high** in `auth`, `events` and `core`. The rationale is valuable, but long comments next to code go stale; the best ones belong in the docs' "why" pages. |

### CI, release and docs

| ID | Sev | Finding |
| --- | --- | --- |
| CI-1 | Medium | See SEC-3 and SEC-4: SHA pinning, Dependabot for actions and npm, `pnpm audit --prod` gate, CodeQL. |
| CI-2 | Low | `codecov-action` runs with `fail_ci_if_error: false`, so a broken upload is silent; the in-repo threshold (90/90) is the real gate. Fine, but the Codecov patch status then cannot block a merge. |
| CI-3 | Low | The compat jobs run the whole pipeline three times (`ci`, `compat 24`, `compat latest`) including coverage only in the first. Fine for confidence; combined with PERF-7 it is the main cost driver. |
| CI-4 | Low | The post-merge **Version Packages** PR gets no CI (known), so each release needs the empty-commit workaround from the TODO. A small workflow that does it automatically would remove a manual step. |
| DOC-1 | Low | 293 internal links checked, 1 broken anchor (BUG-13). The docs build passes. Adding a link check to CI keeps it that way. |
| DOC-2 | Info | Docs describe the framework's own guarantees in detail (request path, request context, ordering). Several statements were corrected during this period because they were wrong (for example "services using `RequestContext` are unaffected under `blix run`"). Claims about behaviour deserve a test each; the new request-path and request-context pages are good candidates. |

## What is done well

- **Strictness.** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`; type-aware lint with `no-floating-promises` and `no-misused-promises` as errors; `import/no-cycle` enforced.
- **Real-dependency tests.** Postgres-backed tests for `db`, `tenancy` and the example, per-suite table names so suites do not collide, real-socket tests for the HTTP edge cases.
- **Auth design.** Argon2id from `node:crypto` (no native dependency), timing-safe compare, dummy-hash path against account enumeration, refresh rotation with reuse detection and an atomic rotate, claims validated against the app's own schema on both issue and verify.
- **HTTP edge behaviour.** Streaming body limit that cancels the source, backpressure, disconnect propagation through `request.signal`, graceful shutdown, RFC 9457 errors that never leak internals. Documented in "The Request Path" page and covered by tests.
- **DI/core.** Small, readable container; encapsulation via `exports`; lifecycle ordering derived from the dependency graph rather than declared; clear error messages that name the missing piece.
- **Dependency discipline.** `cli` has zero runtime dependencies; `drizzle`, `pg`, `jose`, `zod` are the only third-party runtime deps in the whole repo.
- **Supply chain basics.** npm Trusted Publishing (OIDC), Changesets, frozen lockfile in CI, pnpm's release-age protection, `allowBuilds` allow-list.
- **Docs.** Almost every claim has a page, 99.7% of internal links resolve, an architecture section explains the unusual choices (legacy decorators, TS 7 and Oxc quirks).

## What is next on the agenda

Ordered by value and risk. Size: S under half a day, M about a day, L several days. Owner: **me** = I can do it unattended, **you** = needs a decision, an account or a secret.

Tier numbers 0 to 6 below are P0 to P6 in `TODO.tmp.md` section 0, which is the working copy. One difference: the TODO schedules the peer-dependency decision (MNT-1) at the start of P1, because it changes install requirements and release order for everything after it.

### 0. Housekeeping (done)

| # | Item | Size | Owner |
| --- | --- | --- | --- |
| 0.1 | ~~Merge #73 (request-path docs) and #74.~~ **Done.** | S | you |
| 0.2 | ~~Release (Version Packages PR #70).~~ **Done:** CI triggered with the empty commit, merged, published, verified on the registry and in two fresh installs. | S | you + me |
| 0.3 | ~~Refresh `TODO.tmp.md` and `HANDOVER.md`.~~ **Done:** the TODO now opens with this agenda (section 0, tiers P0 to P6), the handover points to it. | S | me |

### 1. Fix the findings (small PRs, each with a regression test that fails on the old code)

| # | Item | Findings | Size |
| --- | --- | --- | --- |
| 1.1 | db: pool error listener through `LOGGER`, safe default `connectionTimeoutMillis`, test that kills a backend | REL-1, REL-4, TST-2 | S |
| 1.2 | core: run all shutdown hooks and aggregate errors; run hooks for constructed providers when boot fails | REL-2, REL-3 | M |
| 1.3 | http router: error on conflicting param names at registration; percent-decode params; decide on `//` and trailing slashes | BUG-1, BUG-2 | S |
| 1.4 | http: derive `request.url` from `Host` (and an opt-in trusted proxy); exact JSON media type; `WWW-Authenticate` on 401; title table from one source | BUG-4, SEC-11, BUG-8, DRY-7 | M |
| 1.5 | cli/deploy: `Object.hasOwn`/`Map` for the four user-keyed lookups; reject generator names that are not valid identifiers | BUG-3, BUG-7 | S |
| 1.6 | auth: minimum secret length, `requiredClaims: ["exp"]`, optional `issuer`/`audience`, case-insensitive `Bearer`, cap Argon2 parameters | SEC-2, SEC-10 | M |
| 1.7 | deploy: `.strict()` schemas; pin tested default provider CLI versions | SEC-6, SEC-1 | M |
| 1.8 | logging: error-aware, cycle-safe serializer; level check before allocation; optional `redact` | BUG-5, PERF-1, SEC-8 | M |
| 1.9 | openapi: skip or degrade unrepresentable schemas per operation; `io: "input"` for request bodies; no `instanceof` on zod classes | BUG-6 | M |
| 1.10 | CI: SHA-pin actions, Dependabot (actions + npm), `pnpm audit --prod`, CodeQL, `SECURITY.md`; run coverage once; link check for docs | SEC-3, SEC-4, PERF-7, DOC-1 | M |
| 1.11 | Fix the broken doc anchor; remove stale `NPM_TOKEN` plumbing once OIDC is confirmed for every published package | BUG-13, MNT-6 | S |

### 2. Structural decisions (need you)

- **[decide] Peer dependencies (MNT-1).** Move `core`, `di`, `http`, `zod`, `drizzle-orm` to peers where a package extends them. It is a breaking install change for users (they must install the peers), so it fits a minor bump while still 0.x. My recommendation: do it now, before more users.
- **[decide] Security middleware scope (SEC-5).** CORS, security headers, rate limiting, trusted proxy: a new `@blixis-io/security` package, or built into `http`? Recommendation: a small separate package with a guard-and-interceptor API, so apps opt in.
- **[decide] Import-time config validation (MNT-2).** Defer `ConfigModule.forRoot()` validation to boot, or keep and document.
- **[decide] Boot concurrency (PERF-3).** Parallel `onModuleInit` per dependency level: worth the added complexity for serverless cold starts?
- Existing open decisions from the TODO (section 3): SSH-to-VPS deploys, per-PR previews, interactive prompts in `blix deploy init`, `minimumReleaseAgeExclude` in the scaffold, Node-only `http` entry versus a fetch-only one, per-module token scoping.

### 3. Consolidation (after the fixes, to keep them fixed)

| # | Item | Findings | Size |
| --- | --- | --- | --- |
| 3.1 | One package-manager helper (`install`, `exec`, `add`, `detect`) in `@blixis-io/cli`, used by `deploy`, `create-blixis` and the Dockerfile generator | DRY-1 | M |
| 3.2 | One spawn helper and one argument parser (`util.parseArgs`) | DRY-2, DRY-3 | M |
| 3.3 | `defineContextKey<T>()` in `http`; collapse the duplicated guard code in `auth` | DRY-4, DRY-5 | S |
| 3.4 | Deploy: single render-options builder, shared config file names | DRY-6 | S |
| 3.5 | Test plumbing: one Postgres connection constant (env-overridable), reusable composite action for the Postgres service, generated vitest aliases | DRY-8 | S |
| 3.6 | Route all framework error output through the injected logger, with method, path and a request id | MNT-3, REL-5 | M |

### 4. Test and quality investment

- Property-based tests (fast-check) for the router, the JSONC stripper, the PHC parser, and the YAML/Dockerfile renderers. (TST-1)
- A small benchmark script and a CI performance budget (router, handler, validation) so regressions show up. (PERF-8)
- Windows (and macOS) in the `compat` matrix, at least for the CLI packages. (TST-5)
- Replace timing windows with deterministic latches in the socket tests I added. (TST-4)
- Per-package coverage floors; re-audit the 24 `v8 ignore` blocks. (TST-3, TST-6)
- Type-level tests for the decorator typings. (TST-7)
- An exports/API snapshot check (`publint`, `attw`, or api-extractor). (MNT-8)

### 5. Carried over from the TODO (still open)

- Docs: design principles page (low priority).
- hello-api: a real, tested `blix deploy` config and docker target.
- Compat matrix gaps: Postgres 16 and 17, TypeScript 5 and 6, a Jest transformer, npm/yarn/bun real installs, Bun/Deno/Cloudflare for the fetch handler.
- `blix run`: `--json` output, `blix new command` generator, a real `db:migrate`/seed command in `@blixis-io/db`.
- Account-dependent verifications: real registry push, generated workflows running, real `vercel deploy` / `netlify deploy`. **[you]**
- Revoke any leftover npm token. **[you]**
- bundle-cms: tell Codex what now exists (`@Command`, `@OnEvent`, deploy, `createFetchHandler`, `RequestContext` under `blix run`); `@blixis-io/create-cms` placeholder and trusted publisher. **[you]**

### 6. New capability, once the above is under control

In the order the TODO already suggests:

1. `@Cron` in a new `@blixis-io/schedule` package (needs a 0.0.0 placeholder and trusted publisher first, **[you]**).
2. Auth: refresh and session helpers, asymmetric keys/JWKS, sign-in rate limiting (ties to SEC-5).
3. `@blixis-io/queue` (`@Queue` / `@Process`), `@blixis-io/health`.
4. Per-route `@Version`, `@Header`, `@Redirect`, `@Sse` in `http`.

## Not reviewed, or only lightly

- Prose quality and accuracy of the docs beyond the links and the pages touched recently.
- `packages/testing`, `packages/method-hooks` and `packages/openapi` were read less closely than `http`, `core`, `di`, `auth`, `db`, `deploy`, `cli`.
- The generated YAML for GitLab and Bitbucket (never run on those services; already a known gap).
- Memory and CPU profiling under real load; no load test was run.
- Windows and macOS behaviour; Deno and Cloudflare Workers runtime behaviour.
- A line-by-line security audit. This was a risk-focused review; a dependency of the size of `jose`, `pg` and `drizzle-orm` was treated as trusted.

## Reproducing the measurements

```bash
pnpm run test:coverage                                   # coverage numbers
pnpm run lint                                            # lint warnings
pnpm audit                                               # advisories
npx jscpd@4 packages examples --pattern "**/src/**/*.ts" \
  --ignore "**/*.test.ts,**/test-fixtures/**,**/dist/**" \
  --min-lines 8 --min-tokens 70                          # exact duplication
```

The reproduced findings (REL-1, REL-2, REL-3, BUG-1 to BUG-4, BUG-6, BUG-7) were each shown with a throwaway test or script that was deleted afterwards; no code was changed for this review. Each fix PR should add the permanent regression test.
