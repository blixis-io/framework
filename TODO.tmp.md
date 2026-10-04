# Blixis Framework: working TODO (temporary; committed so cloud sessions can read it)

Updated 2026-10-02 (after merging #67 and its successful release workflow). Delete when done. `[you]` = needs your hands (npm, browser, account), `[me]` = I can do it, `[decide]` = needs a decision first.

## 0. Right now

State of `main`: head `09d7d64` (handover/TODO docs on top of #67). One open PR: `feat/http-malformed-edge-cases`. Release #65 was verified; post-merge release workflow for #67 also passed.

- [x] #59 (Version Packages) and #60 (http: route info in ExecutionContext, route metadata, `@GlobalGuard`) merged; #61 (auth decorators), #62 (Version Packages) merged
- [x] #58-#62 released 2026-10-02 (create-blixis 0.2.0, http 0.4.0, auth 0.2.0, openapi 0.2.4, tenancy 0.1.5, testing 0.1.5); verified on the registry + a real server with protectAllRoutes over a socket (401/403/200)
- [x] #63 Codecov replaces the old coverage tool (CODECOV_TOKEN set by the user; upload only in the `ci` job)
- [x] #64 `blix doctor` merged and released in cli 0.4.0
- [x] #66 deploy init reuses shared app config merged and released in deploy 0.4.1. Precedence per field: flag > config > default. Full CI exited 0 (909 tests); built and released CLIs generated working entries for all three providers in Node. Not verified for this change: live deployments, provider build tools or workerd.
- [x] #65 Version Packages merged and published 2026-10-02: cli 0.4.0, deploy 0.4.1, commands 0.1.2. Registry versions verified; clean pnpm install with `minimumReleaseAge=0` passed CLI version/doctor, real app command execution, generated handlers returning HTTP 200 for all three providers in Node 26, and per-field flag override.
- [x] #67 CI download fix merged. All GitHub checks passed with fresh EditorConfig v4.0.2 downloads on all three runners; post-merge release workflow 37013625852 succeeded.
- [x] earlier this session: #43-#58 (OIDC fixes, deploy targets Docker/Vercel/Netlify/Cloudflare, GitLab/Bitbucket CI, `@Command`, `@OnEvent`, `@Transactional`, duplicate-copy guard fix, create-blixis `--deploy`); details in sections 1-2 and 4-5
- [ ] PR open: `feat/http-malformed-edge-cases` (http patch: malformed-HTTP socket tests + quiet handling of mid-body client disconnects; see section 7). Review and merge [you]
- [ ] pick the next thing [decide]. Suggested order: `@Cron` in a new `@blixis-io/schedule` package (needs a 0.0.0 placeholder + trusted publisher first [you]), then more auth (refresh/session helpers), then the account-dependent verifications (section 4)

## 1. Release history (done)

- [x] #65 released 2026-10-02: cli 0.4.0, deploy 0.4.1, commands 0.1.2. Verified on npm and with a clean install (details in section 0).
- [x] 2026-10-02 big release: create-blixis 0.1.2, core 0.2.1, di 0.1.1, http 0.3.0, cli 0.2.0, deploy 0.2.0 (new), events 0.1.2 (new), testing 0.1.2 (new), openapi 0.2.1, auth/config/db/logging/tenancy 0.1.2. All via OIDC, no NPM_TOKEN. Verified on the registry and with real installs of the Docker/Vercel/Netlify targets.
- [x] trusted publishers fixed for cli, di, method-hooks (stage-only entries revoked, re-added with --allow-publish)
- [x] #43 events/testing un-ignored, #44 CHANGELOG.md exempt from trailing-whitespace check, #45 docs for the pnpm 24h gate

## 2. Release #49 (published 2026-10-02)

- core 0.3.0 (OnApplicationBootstrap hook, Application.resolved()), cli 0.3.0 (`blix run`), events 0.2.0 (@OnEvent), commands 0.1.1 (new), deploy 0.2.1, http 0.3.1, patches for auth, config, db, logging, openapi, tenancy, testing. di 0.1.1 / create-blixis 0.1.2 / method-hooks 0.1.0 unchanged.
- core 0.2.1 -> 0.3.0 changes the range of every dependent: an app on core 0.2.x that upgrades only http gets TWO copies of core; the duplicate-copy guard fails it loudly at import. Worth a sentence in release notes [decide]
- for the next release with a NEW package: placeholder (0.0.0) + `npm trust github <pkg> --repo blixis-io/framework --file release.yml --allow-publish -y` first

## 3. Decisions waiting on you

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
- [ ] provider CLIs default to `cliVersion: "latest"`: consider pinning a tested version in generated config
- [ ] ideas only: `blix deploy rollback` / `status`; reusable GitHub workflow instead of a generated file; OIDC to cloud registries

## 5. Decorators and discovery

Built:
- [x] `OnApplicationBootstrap` + `Application.resolved()` in core (#46): the discovery hook other decorators can use
- [x] `@Command` / `@Option` / `@Argument` + `blix run` in new `@blixis-io/commands` (#47). Runtime package (NOT cli: command classes are app code that runs in production, cli is a devDependency). core/di/cli are peers. Docs: Writing Commands guide + reference.
- [x] `@OnEvent` in events, typed to the app's event map, compile-checked (#48)

Follow-ups for what was just built:
- [ ] `blix run` boots with createApplication, so RequestContext (provided by the http wrapper) isn't registered: a command that injects it fails. Documented. Decide if `blix run` should add it for apps that import http [decide]
- [ ] commands: `--json` output, `blix new command` generator, shipping a real example command (db:migrate / seed) in `@blixis-io/db`
- [ ] @OnEvent only sees events emitted after boot (not from onModuleInit); transient providers unsupported. Documented.
- [ ] add a `@Command` and an `@OnEvent` example to examples/hello-api

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
- [ ] check the EXIT CODE of `pnpm run ci`, not a grep of it (editorconfig step was invisible twice)
- [ ] use the session scratchpad, never /tmp (slipped again: ci.out, ec.out)
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

Cleanup:
- [x] Checked `allowBuilds: esbuild: true`: esbuild 0.28.2 is present as a Vite dependency in the current lockfile. Keep the entry; the earlier claim that esbuild isn't installed was stale.
- [x] CI flake addressed in #67: pass GITHUB_TOKEN to all three `pnpm run ci` workflow steps for authenticated EditorConfig downloads. Full local CI, all PR checks and the post-merge release workflow passed; fresh downloads confirmed on PR runners.
- [ ] revoke any leftover npm token (NPM_TOKEN secret already deleted from GitHub)

## 7. Framework backlog (external review + this session)

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
