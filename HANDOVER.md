# Handover: Blixis Framework

Committed so cloud sessions and other agents can read it. Read this first, then `TODO.tmp.md`. Both are meant for any coding agent (Codex, Claude Code) picking up the work.

Last updated: 2026-10-02, after opening the malformed-HTTP edge-case PR (`feat/http-malformed-edge-cases`).

## What this is

pnpm 11 + Turborepo monorepo, GitHub `blixis-io/framework`, npm scope `@blixis-io`. A NestJS-style framework: legacy decorators, DI container, modules, Web-standard `Request`/`Response` HTTP, plus db, auth, events, commands, deploy, CLI and a scaffolder. Docs live in `docs/` (Astro Starlight).

Read `AGENTS.md` before touching Turborepo config.

## Current status

- `main` is at `9c4358a` (#72).
- #72 merged: real-socket RequestContext isolation tests (80 interleaved requests, keep-alive reuse, abandoned and timed-out requests) plus a guarantees section on the Request Context docs page. Tests and docs only; no framework bug found.
- #71 merged: `blix doctor` duplicate check follows the reachable dependency graph, so leftover `.pnpm` folders no longer trigger a false positive (cli patch, queued for the next Version Packages PR). Tested on synthetic fixtures only, not a real pnpm install with leftovers.
- #69 merged (was `feat/http-malformed-edge-cases`): malformed-HTTP tests over a real socket against the Node adapter, plus a fix (http patch). A client that disconnects mid-body no longer logs two server-error stack traces; a truncated body now answers 400. Verified in a cloud session: build, typecheck, lint and all 922 tests passed (Postgres 16 locally; CI uses 18). The editorconfig step could not run there (binary download blocked), so `pnpm run ci` exited 1 at that step only. CI on the PR passed in full, including editorconfig. Also checked `createFetchHandler` under Bun 1.3.13: a mid-body stream error gives 400 and nothing logged.
- 13 packages are on npm, published via Changesets + OIDC Trusted Publishing.
- #65 merged and published successfully: cli 0.4.0, deploy 0.4.1, commands 0.1.2. Verified on npm and in a fresh pnpm install with `minimumReleaseAge=0`: CLI version/doctor, app command execution, provider entries returning HTTP 200 in Node 26, and app flag override. No live provider deployment was run.
- #67 merged: workflow token authenticates EditorConfig binary downloads. Full local CI exited 0 (909 tests); GitHub CI and both compatibility jobs passed with fresh downloads. Post-merge release workflow 37013625852 also passed.
- #66 verified: full `pnpm run ci` exited 0 (909 tests); built CLI generated Vercel, Netlify and Cloudflare entries that returned HTTP 200 in Node. Live provider deployments, provider build tools and workerd were not tested for this change.
- **Full task list, decisions waiting, lessons and backlog: [`TODO.tmp.md`](./TODO.tmp.md).** It is the source of truth. Section 0 = right now, section 6 = lessons to check before starting.
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
10. Version Packages PR (opened by the bot): it never gets CI. Push an empty commit to `changeset-release/main` as the maintainer, again every time `main` moves. The maintainer merges it; npm publish happens by OIDC in the Release workflow.
11. A NEW package needs, before its first release: a `0.0.0` placeholder published by hand (`npm publish --access public` from a temp dir) and `npm trust github <pkg> --repo blixis-io/framework --file release.yml --allow-publish -y`. Both need the maintainer's npm passkey: ask, don't attempt.
12. Never handle secrets: the maintainer sets `CODECOV_TOKEN` and npm auth themselves. Don't paste or print tokens.
13. Use a scratch directory outside the repo for temp files, not the repo and not `/tmp` clutter.

## Verification discipline

- "Done" means verified for real: run the built binary / a real server / a real install, not only unit tests. Prefer a regression test that fails on the old code.
- Import-time code must never throw (test bundled, and in workerd for Workers).
- Tests creating temp dirs: Vite/`NODE_PATH` can resolve this repo's workspace packages from a temp dir; inject the registry or clear `NODE_PATH`.
- pnpm 11 ignores versions younger than 24h (`minimumReleaseAge`). For fresh-release testing: `pnpm --config.minimumReleaseAge=0 ...`.
- zsh: quote globs, and an unquoted `$VAR` is not word-split.
- Lint: use type guards, not casts; exhaustive `default` with `/* v8 ignore */`. Coverage thresholds are 90% lines/branches.

## Prompts to give the agent

Replace the bracketed parts. Each prompt assumes the agent has read this file and `TODO.tmp.md`.

**Continue (default)**
> Read HANDOVER.md and TODO.tmp.md. Pick the first unchecked item in TODO section 0 that is marked [me] or has no owner, state in two sentences what you will build, then do it following the GitHub flow in HANDOVER.md. Stop at an open PR and tell me what to merge.

**Specific task**
> Read HANDOVER.md and TODO.tmp.md. Implement: [task, e.g. "`@Cron` in a new `@blixis-io/schedule` package"]. Follow the GitHub flow, add a changeset and docs, run `pnpm run ci` and check the exit code, verify against the real thing, open a PR. List what you did not verify. Do not merge.

**New package** (adds the npm steps)
> Same as above, and the package is new: write the code and docs, then tell me exactly which `npm publish` placeholder and `npm trust` commands I must run before the first release. Don't run them.

**After I merged a PR**
> I merged #[N]. Sync main, update TODO.tmp.md and HANDOVER.md status, check for a Version Packages PR and tell me whether it needs the empty-commit CI trick, then propose the next task.

**Review before merge**
> Review the diff of PR #[N] against main for bugs, missing tests, missing changeset/docs, and claims in docs that were not verified. Report findings; don't change code.

**Release check**
> Version Packages PR #[N] was merged and published. Verify on the registry (`npm view`, allow for read lag) and with a real install in a scratch project using `--config.minimumReleaseAge=0`, then record the versions in TODO.tmp.md.

## Keeping this file current (for Claude Code or Codex)

After every merged PR, or when I say "update the handover":
1. Update "Last updated" and the `main` head commit (`git log --oneline -1`) and open PRs (`gh pr list`).
2. Make sure `TODO.tmp.md` section 0 matches reality; tick done items, add new ones.
3. Add any new lesson to TODO section 6 and, if it changes the rules, to "Rules of the road" above.
4. To resume with Claude Code, I will say: "Read HANDOVER.md and continue."
