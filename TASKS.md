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
  - [ ] persistent server `error` listener after start (BUG-12): left out of #99, still open, needs a way to test it
- [x] **X-5 OpenAPI matches reality** (#101): problem+json, `securitySchemes` / `security` / `@ApiSecurity`, optional bodies, `204`, `onUnrepresentable`, duplicate `operationId`, contract test
- [x] docs follow-up for the `http` reference (#102)

## Phase 1: production baseline

- [x] **X-6 Request-wide wrapper** (#103): `middleware: []` on `createHttpApplication` and `createFetchHandler`, request context outside the middleware
- [ ] **X-7 Security baseline** [me; needs `[you]` for npm] L, new package `@blixis-io/security`
  - [x] client IP, part 1 (D-3): `currentRemoteAddress()` in `http`, the Node adapter's socket address in the request scope (#121)
  - [x] middleware errors reach the outer middleware as responses (#122): found because a 429 lost its CORS headers
  - [x] `getClientIp(request, { trustedProxyHops, isTrustedProxy })`, `cors()`, `securityHeaders()`, `rateLimit()` with a `RateLimitStore`, bounded in-memory store, Postgres store tested with two instances sharing one limit (security package PR)
  - [x] docs: guide "Securing the API" with the proxy recipe, reference, package README
  - [ ] [you] npm placeholder `0.0.0` and trusted publisher for `@blixis-io/security` (commands in the PR). The package is `private: true` until then, so the release job skips it; after the placeholder exists, remove `private` and the two "not published yet" notes in the guide and the README
  - [ ] apply to sign-in and refresh routes in the reference app (X-14)
- [x] **X-8 Tenant isolation: tested patterns** (#105): real-Postgres isolation suite, RLS suite, docs; no library change needed
- [x] **X-9 Refresh tokens: resilience** (#106): safe write order, optional `rotate()` and `revokeFamily()`, `refreshReuseGraceSeconds` (D-4), Postgres reference store tested
  - [ ] cookie and CSRF guidance (not in #106)
- [ ] **X-10 Observability and health**
  - [x] first half (#104): `onError`, `requestId()`, `accessLog()`, `withResponseHeaders()`
  - [x] route `@blixis-io/events` listener failures (`onHandlerError`) and `@blixis-io/core` rollback failures (`onRollbackError`, forwarded by `http` to `onError`) through injectable hooks (REL-5, MNT-3) (this PR)
  - [x] `HttpApplication.draining` and `startDraining()` (#124)
  - [x] new package `@blixis-io/health` (D-8): `/livez` and `/readyz`, readiness checks registered by providers, not ready while draining; tested that readiness flips while draining and liveness doesn't (health package PR). Private until `[you]` publish a placeholder and set up the trusted publisher, as for `@blixis-io/security`
- [ ] **X-11 Finish release hardening** [me, then you] S to M
  - [x] actions pinned to commit SHAs in every workflow and in the generated deploy workflow; every SHA checked against its tag with the GitHub API (this PR)
  - [x] Dependabot for actions and npm, `audit.yml` (`pnpm audit --prod --audit-level high`, on dependency changes and weekly), `codeql.yml`, `SECURITY.md` (this PR)
  - [x] audit overrides for two docs-toolchain advisories (`http-cache-semantics`, `source-map-js`); one moderate remains, not gating
  - [x] coverage runs once instead of tests twice (PERF-7) and a docs link check runs in `pnpm run ci` (DOC-1); the full `pnpm run ci` passes locally, 98.96% lines
  - [x] CI-4: the release job runs `gh workflow run ci.yml --ref changeset-release/main` (`workflow_dispatch` is the one event the workflow token may start), replacing the manual empty commit; `ci.yml` gained `workflow_dispatch`. **Unverified until the next Version Packages PR**: check that the `ci` check appears on it
  - [ ] [you] enable CodeQL and Dependabot in repo settings; verify branch protection and npm account settings
  - [ ] [you] remove `NPM_TOKEN` plumbing from `release.yml` once OIDC is confirmed for every package (MNT-6)

## Phase 2: adoption

- [ ] **X-12 Fresh-install CI** [me] M to L
  - [x] `scripts/fresh-install.mjs` + `fresh-install.yml`: pack all packages, scaffold with the real `create-blixis`, install the tarballs, build, `blix doctor`, start, call, SIGTERM and assert exit 0; matrix Linux, macOS, Windows x pnpm, npm; weekly and on push/PR (#112). Windows cannot check the graceful stop (no SIGTERM)
  - [x] `publint` and `@arethetypeswrong/cli` for every package (`scripts/check-exports.mjs`, job `package-exports`): all 16 pass (#112)
  - [ ] make the fresh-install jobs a required check once they have been green for a while [you]
  - [ ] a registry mode (install the *published* latest) for the weekly run
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
  - [ ] a Docker image built from a copy of the example (it depends on workspace packages and on the unpublished security and health packages, so not here yet)
  - [ ] CI runs it against the previous *release* to check the upgrade path: needs the registry mode of the fresh-install job (X-12) and the two new packages published
  - [ ] invitations, password reset and email verification are out of scope on purpose

## Phase 3: when demand or measurements justify it

- [ ] **X-15 Outbox example** in the reference app: outbox table in the same transaction, poller, idempotent consumer. No queue abstraction before something needs it. [me] M
- [ ] **X-16 Database operations guide:** migration generation and order, no migration race across replicas at boot, pool sizing across replicas, query deadlines, transaction nesting. [me] M
- [ ] **X-17 Real-socket benchmark:** validation and auth on; tail latency, memory, cold start; environment and limits recorded. No CI budget yet. [me] M
- [ ] **X-18 Property tests** (TST-1) [me] M
  - [x] router: 7 properties with `fast-check` against a brute-force model of the documented rules (winner, 405 with the right `Allow`, 404, registration-order independence, single decoding, malformed escapes), 11 000 generated cases; they fail on the pre-#96 router with a small counterexample (this PR)
  - [ ] the other hand-written parsers: the JSONC stripper in `cli/doctor.ts`, the PHC hash parser in `auth`, the YAML and Dockerfile renderers in `deploy`
- [ ] Deferred, unchanged: uploads, WebSockets, caching, more ORMs/runtimes, Node-only entry split.

## Decisions (all approved as recommended)

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

## Releases

- [x] http 0.8.0, openapi 0.5.0, auth 0.5.1, commands 0.2.3, tenancy 0.3.1, testing 0.3.1 published (#97), confirmed on the registry with `npm view`; no fresh-install check yet (X-12 will automate it)
- [ ] next Version Packages PR: `auth` 0.6.0 (#106), `deploy` patch (pinned actions) and whatever follows. Merging one publishes to npm: `[you]` approve, or say releases are pre-approved.

## Done when

- [x] each reproduced defect has a regression test, and the `close()` and `requestTimeout` doc sentences are true
- [x] the X-8 suite passes and the tenancy docs describe what the helper does and doesn't cover
- [x] the X-9 real-store tests pass
- [x] the X-6 test shows one policy on every request path
- [ ] X-12 passes on the OS and package-manager matrix
- [ ] X-14 deploys from a fresh checkout, with its upgrade path checked in CI
