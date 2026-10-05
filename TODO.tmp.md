# Blixis Framework: working TODO (temporary; committed so cloud sessions can read it)

Updated 2026-10-05, after the 2026-10-05 release (#70) and the full code review ([`review.md`](./review.md)). Delete when done. `[you]` = needs your hands (npm, browser, account, merge), `[me]` = an agent can do it unattended, `[decide]` = needs a decision first.

## 0. Agenda (prioritized)

State of `main`: head `1df2fa8` ("Version Packages" #80). No open PRs. Released 2026-10-05 (third release of the day): db 0.4.0, core 0.4.1, di 0.1.3, confirmed on the registry and in a fresh pnpm project with the published packages (one copy of core; a failed boot with a real pool exits on its own after 39 ms; a killed idle connection reaches `onPoolError` and the next query works). P1 items 1 and 2 are done; item 3 (router) is in #83; item 4 (`request.url`, JSON media type, `WWW-Authenticate`, problem+json titles) is next. Released 2026-10-05, twice. First (#70): commands 0.2.0, http 0.5.0, cli 0.4.1, auth 0.2.1, openapi 0.2.5, tenancy 0.1.6, testing 0.1.6. Second (#77, peers): core 0.4.0, http 0.6.0, auth 0.3.0, config 0.2.0, db 0.3.0, events 0.3.0, logging 0.2.0, openapi 0.3.0, tenancy 0.2.0, testing 0.2.0, commands 0.2.1, create-blixis 0.2.1. All verified on the registry. Real installs outside the workspace (published versions, `--config.minimumReleaseAge=0`): an app with `@blixis-io/http` ran `blix run` and a command injecting `RequestContext` (empty, `doctor` clean, one copy of core/di); an app without http ran `blix run` too, so the optional peer works both ways.

Finding IDs (REL-1, BUG-2, ...) refer to [`review.md`](./review.md), which has the evidence and how each was reproduced. **Work top to bottom.** Each fix is its own PR, with a regression test that fails on the old code, a changeset if a published package changes, and docs in the same PR.

### P0: housekeeping

- [ ] merge the docs PR that carries `review.md`, this TODO and HANDOVER [you]
- [x] merged #73 (request-path docs) and #74 (`blix run` provides `RequestContext`; hello-api `posts:seed` and `@OnEvent` example) [you]
- [x] release #70 merged, published and verified (see above)

### P1: reliability and correctness (do before new features)

Done first, because it changes install requirements and release order:
- [x] **peer dependencies (MNT-1): decided yes, done in #76, released in #77 and verified against the real registry** (pnpm: `auth` alone auto-installs its peers, one copy of core; npm 11: `tenancy` alone auto-installs core, di, http, zod and drizzle-orm, deduped; npm refuses auth 0.3.0 + core 0.3.1 with `ERESOLVE`; pnpm only warns, see item 12 below; `pnpm create blixis` inside the first 24 h installs the previous versions as documented, and it includes `zod`): `core`, `di`, `http`, `zod`, `drizzle-orm` are peers of the packages that build on them; create-blixis installs `zod`; docs have a peer table. Verified with packed tarballs in fresh pnpm and npm 11 installs (one copy each; npm auto-installed missing peers); Changesets dry runs: a lone core patch moves only core, a lone core minor gives dependents patch bumps with updated peer ranges, never a major. Not verified: yarn and bun, and the real conflict error with mismatched published versions. Original problem: published `auth`/`config`/`db`/`events`/`logging`/`openapi`/`tenancy`/`testing` pin `core`, `di` and `http` to exact versions (`npm view @blixis-io/auth dependencies` shows `core 0.3.1`, `di 0.1.2`, `http 0.4.0` at the time of the review), so any patch of core gives apps two copies. Same issue for `zod` and `drizzle-orm`. Recommendation: move `core`, `di`, `http`, `zod`, `drizzle-orm` to `peerDependencies` (`workspace:^`) of the packages that extend them, as `commands` and `deploy` already do. Breaking for installs, fine while 0.x.

Fixes, in order:
- [x] 1. db: pool error listener (`onPoolError`, default `console.error`) and a 10 s default `connectionTimeoutMillis` (#79, db minor). Reproduced first: the original exits 1 with `Unhandled 'error' event` after an idle backend is killed; the fix stays alive and the next query works (built package, real Postgres). 6 tests, 4 fail on the old code. Logging is `console.error` because db has no dependency on `@blixis-io/logging`; routing through the logger is P3 (MNT-3). Not verified: a real failover, the 10 s default against a slow-waking serverless database. REL-1, REL-4
- [x] 2. core and di: `close()` runs every shutdown hook (one failure rethrown as is, several in an `AggregateError`); a failed boot shuts down what was built, then rejects with the original error; `Container.resolveAll()` waits for in-flight resolutions (#81, core patch, di patch). With a real pool: the process stayed alive 10,044 ms after a failed boot on the original, 72 ms on the fix. 11 tests, 10 fail on the old code. Not verified: a dedicated test of `createFetchHandler` retrying boot; a hook that never settles still blocks. REL-2, REL-3
- [x] 3. http router (#83, http patch): each route keeps its own param names (`GET /posts/:id` plus `DELETE /posts/:postId` now both work; supporting it beat throwing, which would have broken apps that already do it); path segments are decoded once before matching (`hello%20world`, `a%2Fb` stays in one param, `+` untouched, `%2520` becomes `%20`, static `café` matches `/caf%C3%A9`); a broken escape answers 400 before any guard. `//` and trailing slashes stay tolerated, documented as deliberate. 14 tests, 12 fail on the old code; real-socket before/after confirmed (DELETE got `null`, params stayed encoded). Watch: a handler that decodes params itself now decodes twice (stated in the changeset). Not verified: OpenAPI path templates beyond the passing suite. BUG-1, BUG-2
- [ ] 4. http: build `request.url` from the `Host` header (opt-in trusted proxy), exact JSON media type, `WWW-Authenticate` on 401, one source for problem+json titles. BUG-4, SEC-11, BUG-8, DRY-7 [me]
- [ ] 5. cli/deploy: `Object.hasOwn`/`Map` for the four user-keyed lookups (`blix add constructor` runs `npm install -D undefined`); reject generator names that are not valid identifiers. BUG-3, BUG-7 [me]
- [ ] 6. auth: minimum secret length, `requiredClaims: ["exp"]`, optional `issuer`/`audience`, case-insensitive `Bearer`, cap Argon2 parameters read from stored hashes. SEC-2, SEC-10 [me]
- [ ] 7. deploy: `.strict()` config schemas (a typo like `pussh: false` currently leaves `push: true`); default to pinned, tested provider CLI versions instead of `latest`. SEC-6, SEC-1 [me; real provider deploys still need accounts [you]]
- [ ] 8. logging: error-aware, cycle-safe serializer (an `Error` in context prints `{}`); check the level before allocating; optional `redact`. BUG-5, PERF-1, SEC-8 [me]
- [ ] 9. openapi: degrade per operation on schemas that can't be represented (`z.date()`, transforms); use `io: "input"` for request bodies; no `instanceof` on zod classes. BUG-6 [me]
- [ ] 10. CI and supply chain: SHA-pin actions (also in the generated deploy workflows), Dependabot for actions and npm, `pnpm audit --prod` gate, CodeQL, `SECURITY.md`, run coverage once instead of tests twice, docs link check, automate the empty commit for the Version Packages PR. SEC-3, SEC-4, PERF-7, DOC-1, CI-4 [me; enabling CodeQL/Dependabot in repo settings [you]]
- [ ] 12. `blix doctor`: report unmet peer ranges among the installed `@blixis-io/*` packages (installed version vs each package's `peerDependencies`). Found while verifying the peer release against the real registry: **npm refuses a mismatch (`ERESOLVE`, clear message) but pnpm 11 only warns** ("Issues with peer dependencies found. Run `pnpm peers check`"; `pnpm peers check` lists them, and `strictPeerDependencies: true` in `pnpm-workspace.yaml` made no difference when tried). A pnpm user on core 0.3.1 with auth 0.3.0 installs fine and is told only by a warning. [me]
- [ ] 11. small cleanups: fix the broken doc anchor (`response-validation.md` to `cookbook/#returning-a-raw-response`), drop stale `NPM_TOKEN` plumbing from `release.yml` once OIDC is confirmed for every published package, delete the stray local `packages/plugins/`. BUG-13, MNT-6, MNT-7 [me; confirm npm tokens [you]]

### P2: decisions that unblock more work

- [ ] [decide] security middleware (SEC-5): CORS, security headers, rate limiting (sign-in has none), trusted proxy. Recommendation: a small separate `@blixis-io/security` package with guard/interceptor APIs, opt-in
- [ ] [decide] import-time config validation (MNT-2): `ConfigModule.forRoot()` validates `process.env` when `AppModule` is imported, so `blix run`, `blix doctor`, OpenAPI generation and tests need a full environment just to import it
- [ ] [decide] parallel `onModuleInit` per dependency level (PERF-3), mainly for serverless cold starts
- [ ] the open decisions in section 3 (SSH deploys, PR previews, interactive `deploy init`, `minimumReleaseAgeExclude` in the scaffold, Node-only http entry, per-module token scoping)

### P3: consolidation (after the fixes, so they stay fixed)

- [ ] one package-manager helper (`install`, `exec`, `add`, `detect`) in `@blixis-io/cli`, reused by deploy, create-blixis and the Dockerfile generator (DRY-1)
- [ ] one spawn helper and one argument parser (`util.parseArgs`) instead of three of each (DRY-2, DRY-3)
- [ ] `defineContextKey<T>()` in http; collapse duplicated guard code in auth (DRY-4, DRY-5)
- [ ] deploy: single render-options builder, shared config file names (DRY-6)
- [ ] test plumbing: one env-overridable Postgres connection constant, a composite action for the Postgres service, generated vitest aliases (DRY-8)
- [ ] route framework error output (unexpected 500s, event-handler failures) through the injected logger with method, path and a request id (MNT-3, REL-5)

### P4: test and quality investment

- [ ] property-based tests (fast-check) for the router, the JSONC stripper in `cli/doctor.ts`, the PHC parser, the YAML/Dockerfile renderers (TST-1)
- [ ] a benchmark script and a CI performance budget (PERF-8)
- [ ] Windows and macOS in the `compat` matrix, at least for the CLI packages (TST-5)
- [ ] replace timing windows with deterministic latches in the socket tests (TST-4)
- [ ] per-package coverage floors; re-audit the 24 `v8 ignore` blocks, one is stale (TST-3, TST-6)
- [ ] type-level tests for the decorator typings (TST-7); an exports/API snapshot check with `publint`/`attw` (MNT-8)

### P5: carried over (still open)

- [ ] docs: design principles page (low priority)
- [ ] hello-api: a real, tested `blix deploy` config and docker target
- [ ] compat matrix gaps: Postgres 16/17, TypeScript 5/6, Jest transformer, npm/yarn/bun real installs, Bun/Deno/Cloudflare for the fetch handler
- [ ] `blix run`: `--json` output, `blix new command` generator, a real `db:migrate`/seed command in `@blixis-io/db`
- [ ] never exercised: real registry push, generated workflows on GitHub/GitLab/Bitbucket, real `vercel deploy` / `netlify deploy` [you + me]
- [ ] revoke any leftover npm token [you]
- [ ] bundle-cms: tell Codex what now exists (`@Command`/`blix run` with `RequestContext`, `@OnEvent`, deploy, `createFetchHandler`); `@blixis-io/create-cms` placeholder and trusted publisher [you] (section 8)

### P6: new capability (once P1 is done)

- [ ] `@Cron` in a new `@blixis-io/schedule` package (needs a `0.0.0` placeholder and trusted publisher first [you])
- [ ] auth: refresh and session helpers, asymmetric keys/JWKS, sign-in rate limiting (ties to SEC-5)
- [ ] `@blixis-io/queue` (`@Queue` / `@Process`), `@blixis-io/health`
- [ ] http: `@Version`, `@Header`, `@Redirect`, `@Sse`

## 1. Release history (done)

Merged and released (moved here from section 0):
- [x] #59 (Version Packages) and #60 (http: route info in ExecutionContext, route metadata, `@GlobalGuard`) merged; #61 (auth decorators), #62 (Version Packages) merged
- [x] #58-#62 released 2026-10-02 (create-blixis 0.2.0, http 0.4.0, auth 0.2.0, openapi 0.2.4, tenancy 0.1.5, testing 0.1.5); verified on the registry + a real server with protectAllRoutes over a socket (401/403/200)
- [x] #63 Codecov replaces the old coverage tool (CODECOV_TOKEN set by the user; upload only in the `ci` job)
- [x] #64 `blix doctor` merged and released in cli 0.4.0
- [x] #66 deploy init reuses shared app config merged and released in deploy 0.4.1. Precedence per field: flag > config > default. Full CI exited 0 (909 tests); built and released CLIs generated working entries for all three providers in Node. Not verified for this change: live deployments, provider build tools or workerd.
- [x] #65 Version Packages merged and published 2026-10-02: cli 0.4.0, deploy 0.4.1, commands 0.1.2. Registry versions verified; clean pnpm install with `minimumReleaseAge=0` passed CLI version/doctor, real app command execution, generated handlers returning HTTP 200 for all three providers in Node 26, and per-field flag override.
- [x] #67 CI download fix merged. All GitHub checks passed with fresh EditorConfig v4.0.2 downloads on all three runners; post-merge release workflow 37013625852 succeeded.
- [x] earlier this session: #43-#58 (OIDC fixes, deploy targets Docker/Vercel/Netlify/Cloudflare, GitLab/Bitbucket CI, `@Command`, `@OnEvent`, `@Transactional`, duplicate-copy guard fix, create-blixis `--deploy`); details in sections 1-2 and 4-5
- [x] #69 malformed-HTTP socket tests and quiet mid-body disconnects (http patch); #71 `blix doctor` follows the reachable dependency graph (cli patch); #72 RequestContext isolation tests under real sockets; #73 request-path docs page; #74 `blix run` provides `RequestContext` plus hello-api command and listener (commands minor, http minor); #70 release 2026-10-05: commands 0.2.0, http 0.5.0, cli 0.4.1, auth 0.2.1, openapi 0.2.5, tenancy 0.1.6, testing 0.1.6, verified on the registry and in fresh installs with and without http
- [x] full code review: [`review.md`](./review.md) (no Critical findings; one High, reproduced)

Earlier releases:

- [x] #65 released 2026-10-02: cli 0.4.0, deploy 0.4.1, commands 0.1.2. Verified on npm and with a clean install (details in section 0).
- [x] 2026-10-02 big release: create-blixis 0.1.2, core 0.2.1, di 0.1.1, http 0.3.0, cli 0.2.0, deploy 0.2.0 (new), events 0.1.2 (new), testing 0.1.2 (new), openapi 0.2.1, auth/config/db/logging/tenancy 0.1.2. All via OIDC, no NPM_TOKEN. Verified on the registry and with real installs of the Docker/Vercel/Netlify targets.
- [x] trusted publishers fixed for cli, di, method-hooks (stage-only entries revoked, re-added with --allow-publish)
- [x] #43 events/testing un-ignored, #44 CHANGELOG.md exempt from trailing-whitespace check, #45 docs for the pnpm 24h gate

## 2. Release #49 (published 2026-10-02)

- core 0.3.0 (OnApplicationBootstrap hook, Application.resolved()), cli 0.3.0 (`blix run`), events 0.2.0 (@OnEvent), commands 0.1.1 (new), deploy 0.2.1, http 0.3.1, patches for auth, config, db, logging, openapi, tenancy, testing. di 0.1.1 / create-blixis 0.1.2 / method-hooks 0.1.0 unchanged.
- core 0.2.1 -> 0.3.0 changes the range of every dependent: an app on core 0.2.x that upgrades only http gets TWO copies of core; the duplicate-copy guard fails it loudly at import. Worth a sentence in release notes [decide]
- for the next release with a NEW package: placeholder (0.0.0) + `npm trust github <pkg> --repo blixis-io/framework --file release.yml --allow-publish -y` first

## 3. Decisions waiting on you

The decisions from the code review (peer dependencies, security middleware, import-time config validation, boot concurrency) are listed in section 0, P1 and P2.

- [decide] SSH-to-VPS deploys in `blix deploy`? (I plan "no" for v1)
- [decide] preview deployments per PR in v1? (I plan "no")
- [decide] interactive prompts for `blix deploy init` when flags are missing (node:readline is enough, cli stays dependency-free)
- [decide] should create-blixis write `minimumReleaseAgeExclude: ["@blixis-io/*"]` into the scaffolded pnpm-workspace.yaml? (saves users a confusing 24h failure in CI/Vercel/Docker; weakens a pnpm security default for our own scope). I lean no: documented in #45.
- [decide] `@blixis-io/http` imports node:http at the top level: document as Node-only, or split a fetch-only entry
- [decide] per-module token scoping (private same-named tokens across modules): no use case yet

## 4. blix deploy roadmap

- [x] M0 spikes, M1 cli plugin commands, M2 deploy core (Docker + GitHub Actions), M3 createFetchHandler + Vercel + Netlify
- [x] M4 GitLab CI + Bitbucket Pipelines generators (#53, deploy minor). Verified: YAML parses, job commands ran in clean node:24 (pnpm + npm), docker client download on amd64. NOT run on GitLab/Bitbucket (dind / bitbucket docker service unverified) [you + me later: needs accounts]
- [x] M5 Cloudflare Workers target (see section 0; the Rolldown idea was unnecessary)
- [x] M6 create-blixis `--deploy <target> --ci <provider>` (#58, create-blixis minor); verified from the registry (npm). Remaining M6 bits: `blix deploy doctor` polish, and create-cms offering the same once it exists [me, later]
- [x] deploy init reads the `app` section of blix.config (`{ module, export }`) for Vercel, Netlify and Cloudflare; explicit app flags override config values, missing fields use the existing defaults (#66)
- [ ] never exercised: real registry push, the generated workflow running on GitHub, real `vercel deploy` / `netlify deploy` (need accounts / a throwaway repo) [you + me]
- [ ] provider CLIs default to `cliVersion: "latest"` and run with deploy tokens in the environment: pin a tested version (now agenda P1.7, SEC-1)
- [ ] ideas only: `blix deploy rollback` / `status`; reusable GitHub workflow instead of a generated file; OIDC to cloud registries

## 5. Decorators and discovery

Built:
- [x] `OnApplicationBootstrap` + `Application.resolved()` in core (#46): the discovery hook other decorators can use
- [x] `@Command` / `@Option` / `@Argument` + `blix run` in new `@blixis-io/commands` (#47). Runtime package (NOT cli: command classes are app code that runs in production, cli is a devDependency). core/di/cli are peers. Docs: Writing Commands guide + reference.
- [x] `@OnEvent` in events, typed to the app's event map, compile-checked (#48)

Follow-ups for what was just built:
- [x] `blix run` and RequestContext: you chose "blix run provides it". `bootApplication` wraps the root with http's now-exported `RequestContextModule` when `@blixis-io/http` is importable (optional peer of commands; http minor + commands minor). Found via hello-api: its guards and PostsService inject RequestContext, so NO hello-api command could boot. The old docs claim that services using it only during requests were unaffected was wrong (singletons all resolve at boot); corrected.
- [ ] commands: `--json` output, `blix new command` generator, shipping a real example command (db:migrate / seed) in `@blixis-io/db`
- [ ] @OnEvent only sees events emitted after boot (not from onModuleInit); transient providers unsupported. Documented.
- [x] `@Command` and `@OnEvent` example in examples/hello-api: `posts:seed` command, `PostActivity` listener, `events.ts`; PostsService emits `post.created`/`post.deleted`. 10 e2e tests. Verified for real: built and ran `blix run`, `blix run posts:seed --help` and `blix run posts:seed -n 2` against the local Postgres (rows 515, 516 left in the dev DB; tests wipe the table). Afterwards verified from the published packages in fresh pnpm installs outside the workspace (see section 0): the optional http peer works with and without `@blixis-io/http`.

Still ideas (each can reuse the bootstrap discovery hook):
- db: `@Repository(table)`
- auth: DONE as #60 (http: route info in ExecutionContext, SetRouteMetadata, @GlobalGuard) + #61 (auth: @Roles, @Public, AuthGuard, opt-in protectAllRoutes)
- tenancy: `@CurrentTenant()` parameter decorator; `@TenantScoped()`
- openapi: `@ApiResponse`, `@ApiBody`, `@ApiHeader`, `@ApiExcludeEndpoint()`
- config: `@Env("PORT")` / `@Config("db.url")`
- logging / method-hooks: `@Logged()`, `@Timed()`, `@Cacheable(ttl)`, `@Retry(n)`, `@Timeout(ms)`, `@CircuitBreaker`
- http: `@Version("v2")`, `@Header(...)`, `@Redirect(url)`, `@Sse()`
- new packages: `@blixis-io/schedule` (`@Cron`), `@blixis-io/queue` (`@Queue` / `@Process`), `@blixis-io/health`
`@Transactional` is DONE (#50). [decide] pick the next one; suggestion: `@Cron`.

## 6. Hygiene and lessons (check these before starting work)

Process:
- [ ] check the EXIT CODE of `pnpm run ci`, not a grep of it (editorconfig step was invisible twice); it failed once more on diagram indentation in markdown (editorconfig wants even left-padding)
- [ ] use the session scratchpad, never /tmp (slipped again: ci.out, ec.out)
- [ ] when a release leaves dependents' peer ranges out of date (a core minor, say), add explicit minor changesets for those dependents: by default Changesets only gives them a patch bump with the new range, which is a breaking install change in a patch
- [ ] probing a suspected bug: write a throwaway `zz-*.test.ts` next to the code (reuses the vitest decorator transform), print with `--reporter=verbose`, delete it after; check `git status` is clean
- [ ] a merge refused with "head branch is not up to date" means rebase onto `origin/main` and `git push --force-with-lease`, then wait for the three checks
- [ ] zsh: an unquoted `$VAR` is NOT split into words (use a shell function for `cmd args`), and `--include=*.ts` must be quoted
- [ ] stacked PRs: CI only runs for PRs whose BASE is main, and retargeting doesn't trigger it (close + reopen does); main protection is strict, so after each merge the next PR goes BEHIND and needs a rebase + force-with-lease push; a rebase drops the duplicated parent commit cleanly
- [ ] Version Packages PR: the bot's PR never gets CI; push an empty commit to changeset-release/main every time main moves (the Release job regenerates the branch)
- [ ] tests that create temp dirs: Vite's resolver and NODE_PATH can "find" this repo's own workspace packages from a temp dir; inject the registry or clear NODE_PATH
- [ ] Codex sandbox may block real socket/Postgres tests with EPERM. Rerun CI with the required sandbox approval; do not treat a blocked run as passing. #66 passed outside the sandbox.
- [ ] Claude Code cloud sessions: the container defaults to Node 22 (`nvm install 24`, then put its bin first on PATH). There is no Docker, but the Postgres 16 binaries in `/usr/lib/postgresql/16/bin` can run a throwaway cluster on port 5434 (user/password/db `blixis`) so the db/tenancy/hello-api tests run. The `editorconfig-checker` wrapper cannot download its binary there (GitHub API 403 through the proxy), so `pnpm run ci` exits 1 at format:check. Report that step as not run; don't count it as passing.

npm / pnpm:
- [ ] pnpm 11 ignores versions published < 24h ago (`minimumReleaseAge`) and errors on lockfile entries that young (also inside Vercel/Docker/CI installs). For fresh-release testing use `pnpm --config.minimumReleaseAge=0 ...`; for users `minimumReleaseAgeExclude: ["@blixis-io/*"]` works (documented). For 24h after a release `pnpm create blixis` scaffolds the PREVIOUS versions.
- [ ] `npm trust github <pkg> --repo blixis-io/framework --file release.yml --allow-publish -y`; default is stage-only (E403 on publish); existing entries give E409: list, revoke, re-add. Every package needs its own entry. New package = 0.0.0 placeholder first.
- [ ] `npm view` lags several minutes after a publish; don't trust a single read
- [ ] `pnpm exec` (not only `install`/`add`) re-checks the lockfile against `minimumReleaseAge`: in a fresh-release test pass `--config.minimumReleaseAge=0` to every pnpm command, via a shell function in zsh. Within 24h of a release this also hits anyone adding the new versions

Cleanup:
- [x] Checked `allowBuilds: esbuild: true`: esbuild 0.28.2 is present as a Vite dependency in the current lockfile. Keep the entry; the earlier claim that esbuild isn't installed was stale.
- [x] CI flake addressed in #67: pass GITHUB_TOKEN to all three `pnpm run ci` workflow steps for authenticated EditorConfig downloads. Full local CI, all PR checks and the post-merge release workflow passed; fresh downloads confirmed on PR runners.
- [ ] revoke any leftover npm token (NPM_TOKEN secret already deleted from GitHub)

## 7. Framework backlog (external review + this session)

The code-review findings live in [`review.md`](./review.md) and are scheduled in section 0. This section keeps the older backlog.

- [x] dynamic-module identity / multi-registration, streaming body limit, request timeout, graceful shutdown, response-validation policy, stream cancel on disconnect, serveOpenApi, createFetchHandler, duplicate-copy guard, OnApplicationBootstrap
- [x] (done via `blix doctor`, #64) duplicate-copy detection only works when BOTH copies include the guard; consider a `blix doctor` that checks the installed @blixis-io/* versions agree, decorator flags are set, packageManager is pinned
- [x] (branch `fix/doctor-active-graph`, cli patch) `blix doctor` false positive after pnpm dependency changes: obsolete core/di folders remaining in node_modules/.pnpm are counted as installed duplicates even when `pnpm why` reports one version. Reproduced with published cli 0.4.0 during #65 verification; a clean install passes. Follow the active dependency graph instead of counting every physical folder [me]. Done: `findCopies` walks reachable packages (project `node_modules`, nested `node_modules`, pnpm virtual-store siblings), keyed by real path and manifest name; unlinked leftovers are ignored. Regression test fails on the old code. Not run against a real pnpm install with leftover folders yet.
- [x] concurrency/regression tests for RequestContext under real sockets (branch `test/request-context-concurrency`, tests + docs only, no changeset). `packages/http/src/request-context-sockets.test.ts`: 80 interleaved requests with seeded jitter checked through guard, body read, handler awaits, `setImmediate`/`nextTick`/`Promise.all` and an interceptor before/after `next()`; empty store per request on a reused keep-alive connection (same socket asserted); a client that hangs up mid-handler and a request that hit `requestTimeout` both finish into their own store without touching others. Mutation-checked: swapping in one shared `Map` fails all 4. Ran 5x, stable. No framework bug found. Not covered: context inside a streaming response body's `pull`, and non-Node runtimes (the fetch handler uses the same `AsyncLocalStorage`, untested elsewhere).
- [x] malformed-HTTP edge cases beyond a bad request line (#69 merged, http patch). Real-socket tests in `packages/http/src/production.test.ts`: 431 for oversized headers; 400 from Node's parser for a non-numeric, negative or conflicting Content-Length (and CL + Transfer-Encoding), handler never runs; a short body answers 400 on half-close or 504 with `requestTimeout`; surplus bytes after Content-Length are parsed as the next request (400, connection closed, so the first response can be lost); a chunked body over `bodyLimit` gets 413 while the client is still sending. Each test checks the server still serves a normal request afterwards. **Bug found and fixed:** each client disconnect mid-body logged two stack traces (an "unexpected" 500 from the body read, then `ERR_STREAM_UNABLE_TO_PIPE` from piping into the destroyed socket). Now a failed body read is a 400 and `sendWebResponse` skips a destroyed response, cancelling its body. Regression tests fail on the old code.
- [x] docs: request path overview: new Core Concepts page `concepts/request-path.md` (socket to response, every stage with its status codes). Written from `handler.ts`/`node-adapter.ts`; the 404/405-before-context, guards-before-body and timeout-race-excludes-guards points are read from the code, not separately tested.
- [ ] docs: design principles (low priority; split off from the item above)
- [ ] hello-api: add a `blix deploy` config and the docker target as a real, tested example
- [ ] compat matrix gaps (all "not tested" on the Compatibility page): Postgres 16/17, TypeScript 5/6, Jest transformer, npm/yarn/bun real installs, Bun/Deno/Cloudflare

## 8. bundle-cms (separate repo, handed to Codex)

- [x] prompt written (create-cms scaffolder, api/dashboard/both, generated API key, milestones 0..5)
- [ ] tell Codex about what now exists: `@Command` / `blix run` (migrations, seeding, maintenance tasks), `@OnEvent` (domain events), `@blixis-io/deploy`, `createFetchHandler`, events/testing published
- [ ] `pnpm create @blixis-io/cms` needs a package named `@blixis-io/create-cms` (org-owned, unlike create-blixis); placeholder + trusted publisher when it exists [you]
- [ ] decide whether `create-blixis cms <name>` should delegate to it
- [ ] review docs/framework-gaps.md in the CMS repo as Codex records gaps

## 9. Ideas parking lot

- `blix new <thing>` generators beyond controller/service/module/guard/interceptor (command, event handler, migration)
- `blix dev` as a first-class command (tsc watch + node --watch) instead of a scaffolded script
- publish a "starter" repo template on GitHub as an alternative to create-blixis
