# Handover: Blixis Framework

Committed so cloud sessions and other agents can read it. Read this first, then `TODO.tmp.md` (section 0 is the prioritized agenda), then `review.md` for the evidence behind each finding. All three are meant for any coding agent (Codex, Claude Code) picking up the work.

Last updated: 2026-10-05, after the 2026-10-05 release (#70) and the full code review.

## What this is

pnpm 11 + Turborepo monorepo, GitHub `blixis-io/framework`, npm scope `@blixis-io`. A NestJS-style framework: legacy decorators, DI container, modules, Web-standard `Request`/`Response` HTTP, plus db, auth, events, commands, deploy, CLI and a scaffolder. Docs live in `docs/` (Astro Starlight).

Read `AGENTS.md` before touching Turborepo config.

## Current status

- `main` is at `ebba27d` ("Version Packages", #84). All tests pass on `main`: 936 (lint 0 errors, 9 intentional `no-await-in-loop` warnings), coverage 99.1% lines and 95.2% branches.
- Open PRs: the item-4 PR (http origin, JSON media type, `WWW-Authenticate`, problem titles; http/auth minors). **Released 2026-10-05 (#84):** http 0.6.1: each route keeps its own `:param` names, path segments are percent-decoded once, a broken `%` escape is a 400; verified from the registry against a real server.
- **Released 2026-10-05 (#80):** db 0.4.0 (idle-connection errors no longer crash the process, `onPoolError` option, 10 s default connection timeout), core 0.4.1 (`close()` runs every shutdown hook; a failed boot shuts down what it built), di 0.1.3 (`resolveAll()` waits for in-flight resolutions). Verified from the registry in a fresh pnpm project against a real Postgres.
- **Released 2026-10-05 (#77, peer dependencies):** core 0.4.0, http 0.6.0, auth 0.3.0, config 0.2.0, db 0.3.0, events 0.3.0, logging 0.2.0, openapi 0.3.0, tenancy 0.2.0, testing 0.2.0, commands 0.2.1, create-blixis 0.2.1. `core`, `di`, `http`, `zod` and `drizzle-orm` are now peer dependencies of the packages that build on them (review finding MNT-1). Verified from the registry in fresh installs: pnpm and npm auto-install missing peers and give one copy each; npm refuses a mismatched set (`ERESOLVE`), pnpm 11 only warns (follow-up: a `blix doctor` check, TODO P1 item 12).
- **Released earlier the same day (#70):** commands 0.2.0, http 0.5.0, cli 0.4.1, auth 0.2.1, openapi 0.2.5, tenancy 0.1.6, testing 0.1.6. Verified on the registry, and in two fresh pnpm installs outside the workspace using the published versions with `--config.minimumReleaseAge=0`: an app with `@blixis-io/http` (guard and command both inject `RequestContext`; `blix run`, `blix run ping` and `blix doctor` all fine, one copy of core and di) and an app without http (`blix run hello` fine). 13 packages are on npm, published via Changesets and OIDC Trusted Publishing.
- **What those releases contain:** `blix run` now provides `RequestContext` when `@blixis-io/http` is importable (http exports `RequestContextModule`; http is an optional peer of commands); `blix doctor` counts only reachable copies of core/di (#71); a truncated request body answers 400 and a client that disconnects mid-body no longer logs two stack traces (#69).
- Merged since the last handover, not published packages: #72 (RequestContext isolation tests under real sockets), #73 (new docs page "The Request Path"), and hello-api now has a `posts:seed` command and an `@OnEvent` listener (#74).
- **Code review done: [`review.md`](./review.md).** No Critical findings, one High (reproduced): `@blixis-io/db` has no `pool.on("error")`, so an idle Postgres connection dropping crashes the process. Next highest: a failing shutdown hook skips closing the pool; a failed boot runs no shutdown hooks; the router silently mis-binds params when two methods name one path param differently and never percent-decodes; library packages pin `core`/`di`/`http` to exact versions (two copies after any patch). The fixes are scheduled in TODO section 0, P1, in order.
- **Full task list, prioritized agenda, decisions waiting, lessons and backlog: [`TODO.tmp.md`](./TODO.tmp.md).** It is the source of truth. Section 0 = agenda (work top to bottom), section 6 = lessons to check before starting.
- Older status, kept short: #65 to #67 (cli 0.4.0, deploy 0.4.1, commands 0.1.2, EditorConfig download fix) were verified the same way on 2026-10-02. Live provider deployments, provider build tools and workerd have still never been exercised.
- Package map and tech decisions are in the Claude memory files (`~/.claude/projects/-Users-michael-Projects-Blixis-Framework/memory/`) if you have access; otherwise read `docs/src/content/docs/` (concepts, guides, reference, architecture).

## Rules of the road (GitHub flow)

1. Never commit to `main`. Branch from an up-to-date `main`: `git switch main && git pull --ff-only && git switch -c feat/<short-name>` (`fix/`, `docs/`, `chore/`, `ci/` also fine).
2. One feature per branch and per PR. Conventional commit subjects (`feat(scope): ...`, `fix(scope): ...`, `docs: ...`, `ci: ...`).
3. Any change to a published package needs a changeset: `.changeset/<name>.md` with the package(s) and `patch`/`minor`/`major`. Docs-only, CI-only and test-only changes don't. `hello-api` and `blixis-docs` are ignored by Changesets.
4. Docs ship in the same PR as the feature (`docs/src/content/docs/...`). Say plainly what was and was not verified.
5. Before pushing run `pnpm run ci` and **check its exit code** (`echo $?`), not a grep of its output. The editorconfig-checker step prints nothing useful.
6. Push, then `gh pr create --base main` with a short body: what changed, how it was verified, what was not verified.
7. **Do not merge. Do not use `--admin`.** The maintainer merges with `gh pr merge N --rebase`. `main` requires the `ci` check; if a merge is refused with "base branch policy", ci is still running: wait.
8. After a merge: `git switch main && git pull --ff-only`, update `TODO.tmp.md` (and this file's status), then pick the next task.
9. Stacked PRs: CI only runs for PRs whose base is `main`. Prefer sequential PRs.
10. If a release leaves dependents' peer ranges out of date (a `core` minor, say), add explicit minor changesets for those dependents: Changesets alone gives them a patch bump with the new range, which is a breaking install change in a patch. (Checked with dry runs of `changeset version` and the changelog switched off.)
11. Version Packages PR (opened by the bot): it never gets CI. Push an empty commit to `changeset-release/main` as the maintainer, again every time `main` moves. The maintainer merges it; npm publish happens by OIDC in the Release workflow.
12. A NEW package needs, before its first release: a `0.0.0` placeholder published by hand (`npm publish --access public` from a temp dir) and `npm trust github <pkg> --repo blixis-io/framework --file release.yml --allow-publish -y`. Both need the maintainer's npm passkey: ask, don't attempt.
13. Never handle secrets: the maintainer sets `CODECOV_TOKEN` and npm auth themselves. Don't paste or print tokens.
14. Use a scratch directory outside the repo for temp files, not the repo and not `/tmp` clutter.

## Verification discipline

- The review's findings are tagged reproduced / verified / suspected. When fixing one, first reproduce it with a failing test, then fix, and say in the PR whether the reproduction matched.
- "Done" means verified for real: run the built binary / a real server / a real install, not only unit tests. Prefer a regression test that fails on the old code.
- Import-time code must never throw (test bundled, and in workerd for Workers).
- Tests creating temp dirs: Vite/`NODE_PATH` can resolve this repo's workspace packages from a temp dir; inject the registry or clear `NODE_PATH`.
- pnpm 11 ignores versions younger than 24h (`minimumReleaseAge`). For fresh-release testing: `pnpm --config.minimumReleaseAge=0 ...`.
- zsh: quote globs, and an unquoted `$VAR` is not word-split.
- Lint: use type guards, not casts; exhaustive `default` with `/* v8 ignore */`. Coverage thresholds are 90% lines/branches.

## Prompts to give the agent

Replace the bracketed parts. Each prompt assumes the agent has read this file, `TODO.tmp.md` and, for fixes, `review.md`.

**Continue (default)**
> Read HANDOVER.md, TODO.tmp.md and review.md. Take the first unchecked item in TODO section 0 (highest priority tier first) that is marked [me]; skip [decide] items and ask me about them. State in two sentences what you will build, then do it following the GitHub flow in HANDOVER.md, with a regression test that fails on the old code. Stop at an open PR and tell me what to merge.

**Specific task**
> Read HANDOVER.md and TODO.tmp.md. Implement: [task, e.g. "`@Cron` in a new `@blixis-io/schedule` package"]. Follow the GitHub flow, add a changeset and docs, run `pnpm run ci` and check the exit code, verify against the real thing, open a PR. List what you did not verify. Do not merge.

**New package** (adds the npm steps)
> Same as above, and the package is new: write the code and docs, then tell me exactly which `npm publish` placeholder and `npm trust` commands I must run before the first release. Don't run them.

**After I merged a PR**
> I merged #[N]. Sync main, update TODO.tmp.md and HANDOVER.md status, check for a Version Packages PR and tell me whether it needs the empty-commit CI trick, then propose the next task.

**Review before merge**
> Review the diff of PR #[N] against main for bugs, missing tests, missing changeset/docs, and claims in docs that were not verified. Check it against the open findings in review.md. Report findings; don't change code.

**Release check**
> Version Packages PR #[N] was merged and published. Verify on the registry (`npm view`, allow for read lag) and with a real install in a scratch project using `--config.minimumReleaseAge=0`, then record the versions in TODO.tmp.md.

## Keeping this file current (for Claude Code or Codex)

After every merged PR, or when I say "update the handover":
1. Update "Last updated" and the `main` head commit (`git log --oneline -1`) and open PRs (`gh pr list`).
2. Make sure `TODO.tmp.md` section 0 (the prioritized agenda) matches reality; tick done items, add new ones, and keep the finding IDs in step with `review.md` (add a one-line status to `review.md` when a finding is fixed).
3. Add any new lesson to TODO section 6 and, if it changes the rules, to "Rules of the road" above.
4. To resume with Claude Code, I will say: "Read HANDOVER.md and continue."
