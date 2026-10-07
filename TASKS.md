# Tasks: external review follow-up

Created 2026-10-06, status updated 2026-10-06 (after #106). Reasoning and designs: [`PLAN.md`](./PLAN.md). Fact-check of the review: [`EXTERNAL-REVIEW-ASSESSMENT.md`](./EXTERNAL-REVIEW-ASSESSMENT.md). Separate from [`TODO.tmp.md`](./TODO.tmp.md); IDs here start with `X-` so they don't clash with its numbering. Delete or merge into the TODO when done.

**Decisions D-1 to D-8 are all approved as recommended** (2026-10-06). `[x]` items name the PR that merged them.

Legend: `[me]` an agent can do it unattended, `[you]` needs your hands (npm, GitHub settings), `[decide]` needs a decision first. Size: S under half a day, M about a day, L several days.

**Rules for every item** (same as the existing backlog): its own PR; a regression test that fails on the old code; a changeset if a published package changes; docs updated in the same PR; say in the PR what was *not* verified.

## Phase 0: correctness (done)

- [x] **X-0** the four reproduced defects became failing tests inside their fix PRs (#96, #98, #99, #100)
- [x] **X-1 Router: method-aware fallback** (#96)
- [x] **X-2 Deadline covers guards and mounted routes** (#100); a late guard no longer starts the next guard or the controller
- [x] **X-3 HTTP boot rolls back** (#98)
- [x] **X-4 Shared close, single `listen()`** (#99)
  - [x] decided D-5: no `shutdownHookTimeout`, documented in `running-in-production.md` instead
  - [x] persistent server `error` listener after start (BUG-12), reported to `onError` with `phase: "server"` (this PR; tested by wrapping `createServer` so a test can make the server emit)
- [x] **X-5 OpenAPI matches reality** (#101): problem+json, `securitySchemes` / `security` / `@ApiSecurity`, optional bodies, `204`, `onUnrepresentable`, duplicate `operationId`, contract test
- [x] docs follow-up for the `http` reference (#102)

## Phase 1: production baseline

- [x] **X-6 Request-wide wrapper** (#103): `middleware: []` on `createHttpApplication` and `createFetchHandler`, request context outside the middleware
- [ ] **X-7 Security baseline** [me; needs `[you]` for npm] L, new package `@blixis-io/security`
  - [x] client IP, part 1 (D-3): `currentRemoteAddress()` in `http`, the Node adapter's socket address in the request scope (#121)
  - [x] middleware errors reach the outer middleware as responses (#122): found because a 429 lost its CORS headers
  - [x] `getClientIp(request, { trustedProxyHops, isTrustedProxy })`, `cors()`, `securityHeaders()`, `rateLimit()` with a `RateLimitStore`, bounded in-memory store, Postgres store tested with two instances sharing one limit (security package PR)
  - [x] docs: guide "Securing the API" with the proxy recipe, reference, package README
  - [x] npm placeholders and trusted publishers for `@blixis-io/security` and `@blixis-io/health` created by the maintainer; `private` removed (this PR), so the next Version Packages PR publishes `0.1.0` of each
  - [ ] apply to sign-in and refresh routes in the reference app (X-14)
- [x] **X-8 Tenant isolation: tested patterns** (#105): real-Postgres isolation suite, RLS suite, docs; no library change needed
- [x] **X-9 Refresh tokens: resilience** (#106): safe write order, optional `rotate()` and `revokeFamily()`, `refreshReuseGraceSeconds` (D-4), Postgres reference store tested
  - [ ] cookie and CSRF guidance (not in #106)
- [ ] **X-10 Observability and health**
  - [x] first half (#104): `onError`, `requestId()`, `accessLog()`, `withResponseHeaders()`
  - [x] route `@blixis-io/events` listener failures (`onHandlerError`) and `@blixis-io/core` rollback failures (`onRollbackError`, forwarded by `http` to `onError`) through injectable hooks (REL-5, MNT-3) (this PR)
  - [x] `HttpApplication.draining` and `startDraining()` (#124)
  - [x] new package `@blixis-io/health` (D-8): `/livez` and `/readyz`, readiness checks registered by providers, not ready while draining; tested that readiness flips while draining and liveness doesn't (health package PR).
- [ ] **X-11 Finish release hardening** [me, then you] S to M
  - [x] actions pinned to commit SHAs in every workflow and in the generated deploy workflow; every SHA checked against its tag with the GitHub API (this PR)
  - [x] Dependabot for actions and npm, `audit.yml` (`pnpm audit --prod --audit-level high`, on dependency changes and weekly), `codeql.yml`, `SECURITY.md` (this PR)
  - [x] audit overrides for two docs-toolchain advisories (`http-cache-semantics`, `source-map-js`); one moderate remains, not gating
  - [x] coverage runs once instead of tests twice (PERF-7) and a docs link check runs in `pnpm run ci` (DOC-1); the full `pnpm run ci` passes locally, 98.96% lines
  - [x] CI-4: the release job runs `gh workflow run ci.yml --ref changeset-release/main` (`workflow_dispatch` is the one event the workflow token may start), replacing the manual empty commit; `ci.yml` gained `workflow_dispatch`. **Unverified until the next Version Packages PR**: check that the `ci` check appears on it
  - [x] Dependabot is enabled and working (it opened PRs within minutes of the merge); rules added so it does not propose `@types/node` past Node 24 or TypeScript 7 for the docs site (astro check needs 5)
  - [ ] [you] enable CodeQL in repo settings (the workflow ran green); verify branch protection and npm account settings
  - [ ] [you] remove `NPM_TOKEN` plumbing from `release.yml` once OIDC is confirmed for every package (MNT-6)

## Phase 2: adoption

- [ ] **X-12 Fresh-install CI** [me] M to L
  - [x] `scripts/fresh-install.mjs` + `fresh-install.yml`: pack all packages, scaffold with the real `create-blixis`, install the tarballs, build, `blix doctor`, start, call, SIGTERM and assert exit 0; matrix Linux, macOS, Windows x pnpm, npm; weekly and on push/PR (#112). Windows cannot check the graceful stop (no SIGTERM)
  - [x] `publint` and `@arethetypeswrong/cli` for every package (`scripts/check-exports.mjs`, job `package-exports`): all 16 pass (#112)
  - [ ] make the fresh-install jobs a required check once they have been green for a while [you]
  - [x] registry mode (`--source registry`: the published `create-blixis` and the published packages, pnpm with `minimumReleaseAgeExclude` so a release made today can be checked) and a `published` job in `fresh-install.yml` on the weekly schedule and by hand; passes locally with npm and pnpm (this PR). The stale `concurrently` install in the script is gone too
  - [ ] unsupported toolchain (decorator metadata dropped, e.g. `tsx`) fails with an actionable message; `blix doctor` already reports the decorator flags, check what it says for the esbuild case
  - [ ] **found by this work:** the scaffold's `concurrently` dev dependency made `npm install` report 2 critical advisories (it pins a vulnerable `shell-quote` exactly); replaced by a generated `scripts/dev.mjs`, `npm audit` is clean (#114)
- [x] **X-13 Stability policy and contribution guide** (#110): `start-here/stability.md` (audience, support, `0.x` rules, deprecation, 1.0 checklist), `CONTRIBUTING.md`, README status section; nothing like it existed before
  - [ ] public issue-sized milestones on GitHub [you]: not something the repository can hold
  - [ ] the policy wording (one-minor deprecation, "Behaviour change" convention) is a proposal written from current practice; the maintainer should adjust it
- [x] **X-14 Reference application** [after X-7, X-9, X-10] L (this PR)
  - [x] `examples/saas-api` (separate from `hello-api`): sign-in and sign-up (one transaction), refresh store with families, orgs/spaces/memberships, a tenant resource with a child, migrations (`blix run db:migrate`), error contract, OpenAPI with security, request-id logs, `/readyz` and draining, CORS and security headers, per-client rate limits shared across instances
  - [x] 45 tests against a real Postgres including the denied cases (non-member 404, cross-tenant id 404, forged tenant, the database's own refusal, the 429) and one limit across two instances
  - [x] README walkthrough and a docs page; the built app was smoke-tested (sign-up, `/me`, request ids in the log, SIGTERM to `503` readiness to exit 0)
  - [x] `blix.config.ts` with a Docker target; `blix deploy --dry-run` and `deploy doctor` work
  - [x] a Docker image built from a copy of the example: `examples/saas-api/Dockerfile` (multi-stage, non-root, ships `migrations/`, `@blixis-io/cli` moved to `dependencies` because `blix run db:migrate` runs in the image), `scripts/docker-image.mjs` and the `docker-image` job in `fresh-install.yml`: pack, copy out of the repo, build, migrate twice, boot against Postgres in a private network, sign up, call `/me`, check non-root, SIGTERM exits 0 after draining. Checked by deleting `COPY migrations` (fails with ENOENT). Shared helper `scripts/lib/standalone.mjs` also backs `upgrade-path`. Not checked: a registry push, a real orchestrator.
  - [x] upgrade path: `scripts/upgrade-path.mjs` + the `upgrade-path` job in `fresh-install.yml` take `examples/saas-api` as it was at the last "Version Packages" commit, install packages packed from the checkout in place of the released ones, type-check (tests included), build and run its tests against Postgres. Checked by removing `Public` from `@blixis-io/auth`'s exports (fails with TS2305). Not a required check: a deliberate breaking change fails until the next release moves the baseline.
  - [ ] invitations, password reset and email verification are out of scope on purpose

## Phase 3: when demand or measurements justify it

- [ ] **X-15 Outbox example** in the reference app: outbox table in the same transaction, poller, idempotent consumer. No queue abstraction before something needs it. [me] M
- [x] **X-16 Database operations guide** (this PR): `guides/database-operations.md` (migrations as a deploy step and the empty-database race, old and new versions running together, pool sizing across replicas, deadlines with `statement_timeout` shorter than `requestTimeout`, transactions, recovery), backed by 3 new real-Postgres tests of the pool settings; claims that are general Postgres practice and not run here are labelled
- [x] **X-17 Real-socket benchmark** (this PR): `examples/benchmarks` (5 workloads from bare `node:http` up to the production middleware stack; req/s, p50/p97.5/p99/max, RSS, cold start; the environment printed with the results; exits non-zero on any failed request; a test checks every workload does what it claims), results and how to read them in `architecture/performance.md`. No CI budget by design (shared runners). Finding recorded, not acted on: a controller route costs about 38 us per request over bare Node (3.7x the bare server's rate), not profiled.
  - [ ] a database-backed workload (`saas-api`) and a separate load-generator machine
  - [ ] profile why the framework route is 3.7x bare `node:http` (suspect: the Node to Web `Request`/`Response` conversion) and see whether any of it is avoidable
- [x] **X-18 Property tests** (TST-1) [me] M
  - found by the deploy properties and fixed in the same PR: `--entry` was copied into the Dockerfile `CMD` unescaped (a quote added an argument, a newline added an instruction), a target name went into a shell command line unchecked, and a branch named `1.0` was written into the workflow as the YAML number 1 (a branch `-` did not parse)
  - [x] router: 7 properties with `fast-check` against a brute-force model of the documented rules (winner, 405 with the right `Allow`, 404, registration-order independence, single decoding, malformed escapes), 11 000 generated cases; they fail on the pre-#96 router with a small counterexample (this PR)
  - [x] the YAML and Dockerfile renderers in `deploy` (this PR): 13 properties that parse the generated files with `yaml` and throw hostile names at them; they found real bugs (see below)
  - [x] the JSONC stripper in `cli/doctor.ts` (6 properties: comments and trailing commas anywhere, string contents untouched, identity on plain JSON, never throws, stable) and the PHC hash parser in `auth` (7: agrees with Node's own Argon2 on random small parameters, anything that is not a hash refused with the documented error, the limits hold at their edges and a hash asking for more is refused before any work); both agreed with their documented behaviour, no bug found (#135); mutating each (dropping the trailing-comma check, raising the pass limit) fails them
- [ ] Deferred, unchanged: uploads, WebSockets, caching, more ORMs/runtimes, Node-only entry split.

## Phase 4: API keys (not started; added 2026-10-07)

Today there is **no** API key feature: the guards guide shows one shared secret, `auth` only verifies JWTs. Design and reasoning in `PLAN.md` (Phase 4). Decision D-9: inside `@blixis-io/auth`, **no new package** (so no npm placeholder or trusted publisher needed).

- [ ] **X-19 CIDR matching** in `@blixis-io/security` (`parseCidr`, `ipInCidrs`; IPv4, IPv6, IPv4-mapped; malformed input refused at construction) with a property test against a brute-force model [me] S
- [ ] **X-20 API key guard** in `@blixis-io/auth` [me] L
  - [ ] `blx_<id>_<secret>`, SHA-256 of the secret stored, constant-time compare, secret shown once
  - [ ] `ApiKeyStore` interface + Postgres example and test; fail closed on store errors
  - [ ] scopes, `expiresAt`, `revokedAt`, optional `allowedCidrs`, best-effort `lastUsedAt`
  - [ ] `apiKeys` option on `defineAuthModule`: Bearer JWT or `x-api-key`, same claims shape
  - [ ] one 401 for every failure, similar timing for unknown id and wrong secret
  - [ ] optional positive-lookup cache, default off; revocation latency documented
- [ ] **X-21** per-key rate limit example, `RequireScopes`, used in the reference app [me] S
- [ ] **X-22 Operating keys guide**: rotation with overlap, revocation, what to log (redact `x-api-key` in the access log), where 2FA belongs, proxy setup for IP allowlists [me] M
- [x] the guards guide now compares the shared secret in constant time and says what it is not (this PR)
- [ ] decisions: D-9 inside `auth`, D-10 CIDR in `security`, D-11 SHA-256 for the secret. Written as recommendations; **[you]** confirm or change before X-19 starts.

## Decisions (D-1 to D-8 approved as recommended)

| ID | Decision | Used by |
| --- | --- | --- |
| D-1 | `middleware: []` option only, no `app.use()` | X-6 (done) |
| D-2 | request context starts outside the middleware | X-6 (done), X-10 |
| D-3 | client IP: `RequestContext` field set by the Node adapter, plus `getClientIp()` honouring `trustProxy` | X-7 |
| D-4 | grace window for double refresh: configurable, default off | X-9 (done) |
| D-5 | `shutdownHookTimeout`: document, don't add | X-4 (done) |
| D-6 | access-token revocation hook: not now, document short TTLs | X-9 (done as docs) |
| D-7 | security baseline in a new package `@blixis-io/security` | X-7 |
| D-8 | health in its own package `@blixis-io/health` | X-10 |
| D-9 | API keys inside `@blixis-io/auth`, no new package | X-20 (proposed) |
| D-10 | CIDR matching in `@blixis-io/security` | X-19 (proposed) |
| D-11 | store SHA-256 of the key secret, not a slow hash | X-20 (proposed) |

## Releases

- [x] http 0.8.0, openapi 0.5.0, auth 0.5.1, commands 0.2.3, tenancy 0.3.1, testing 0.3.1 published (#97), confirmed on the registry with `npm view`; no fresh-install check yet (X-12 will automate it)
- [x] Version Packages #107 merged and published (2026-10-07): 15 packages incl. `@blixis-io/security` 0.1.0 and `@blixis-io/health` 0.1.0 (first releases), `core` 0.5.0, `auth` 0.6.0, `openapi` 0.5.0, `deploy` 0.6.0, `http` 0.8.0; the registry fresh-install job (3 OSes x npm/pnpm) passed against what is live. Merging a Version Packages PR still publishes: `[you]` approve each.
  - note: `#107` needed a `ci` run on its head; the `workflow_dispatch` run produced green check runs but GitHub did not count them; the PR merged after the maintainer dealt with the `pull_request` runs (cause not confirmed).

## Done when

- [x] each reproduced defect has a regression test, and the `close()` and `requestTimeout` doc sentences are true
- [x] the X-8 suite passes and the tenancy docs describe what the helper does and doesn't cover
- [x] the X-9 real-store tests pass
- [x] the X-6 test shows one policy on every request path
- [ ] X-12 passes on the OS and package-manager matrix
- [ ] X-14 deploys from a fresh checkout, with its upgrade path checked in CI
