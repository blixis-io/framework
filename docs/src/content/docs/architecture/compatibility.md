---
title: Compatibility
description: What Blixis is verified against, what isn't, and the evidence for each claim.
sidebar:
  order: 3
---

Each row says how the claim is backed. **CI** means a workflow job runs it on every push. **Checked** means someone ran it by hand on the date shown, with no automated guard. **Not tested** means exactly that: it may well work, but nothing here says so.

## Runtime

| | Status | Evidence |
|---|---|---|
| Node 24 | Supported | CI: the required `ci` job and the `compat (node 24)` job. `engines` is `>=24`. |
| Node latest | Tracked | CI: the `compat (node latest)` job. Not a required check, so a newer Node breaking it shows up there first. |
| Node 22 and older | Not supported | `engines` rejects it. The framework relies on Node 24's built-in `fetch`/`Request`/`Response`. |
| Bun, Deno, Cloudflare Workers | Not tested | The core and request handler (`createHandler`) are built on Web-standard `Request`/`Response`, but `@blixis-io/http` imports `node:async_hooks` and `node:http`, and nothing runs on another runtime. Treat as unsupported. |

## Toolchain

| | Status | Evidence |
|---|---|---|
| TypeScript 7 (`tsc`) | Supported | CI builds every package and the `hello-api` example with `typescript@7.0.2`. Checked 2026-10-01: a decorated class compiled by `tsc` 7.0.2 emits `design:paramtypes`. |
| TypeScript 5 and 6 | Not tested | Packages are built and typechecked with 7 only. |
| Vitest 5 + Oxc | Supported | CI: the whole test suite runs on it, with the two decorator flags set (see [Installation](/framework/start-here/installation/)). |
| `tsx`, `esbuild`, esbuild-based Vite | Does not work | Checked 2026-10-01: `esbuild` 0.28.2 given `experimentalDecorators` + `emitDecoratorMetadata` emits no `design:paramtypes`, so constructor injection can't see parameter types. An upstream limitation, not something Blixis can configure around. |
| Jest | Not tested | |

## Package managers

| | Status | Evidence |
|---|---|---|
| pnpm 11 | Supported | CI uses `pnpm@11.25.0`. `pnpm create blixis` scaffold → install → build → run was checked end to end against the published packages (2026-10-01). |
| npm, yarn, bun | Not tested | `create-blixis` detects them and unit tests cover the commands it runs, but a real install with each was not run. |

## Deployment targets

`blix deploy` ([Deploying](/framework/guides/deploying/)) supports Docker, Vercel and Netlify. Cloudflare Workers is not a `blix deploy` target yet; its row records what was tried by hand on 2026-10-01 so it starts from facts, not guesses.

| | Status | Evidence |
|---|---|---|
| Docker (`blix deploy`) | Supported | Checked: scaffold, `blix deploy init`, a real image built from the generated Dockerfile (173 MB), run, called, and stopped gracefully (exit 0). Registry push and the generated GitHub Actions workflow were not run against a real registry or GitHub; they are covered by unit tests, a dry run, and the workflow parsing as valid YAML. |
| Cloudflare Workers (not a `blix deploy` target yet) | Works locally | Checked: a Rolldown bundle (with `export default createFetchHandler(AppModule)`) ran in `workerd` (`wrangler dev --local`, `nodejs_compat`): routing, 404/405, a POST body with Zod validation, async handlers. Not tried: a real Cloudflare deploy, `pg` from a Worker, bundle size limits. |
| Netlify (`blix deploy`) | Verified up to the deploy call | Checked 2026-10-01, from files `blix deploy init` generated: `netlify dev` served the function, and `netlify functions:build` produced a zip that answered correctly when extracted and run. Not tried: a real `netlify deploy` (needs an account). |
| Vercel (`blix deploy`) | Verified up to the deploy call | Checked 2026-10-01, from files `blix deploy init` generated: `vercel build` produced a `nodejs24.x` function that answered correctly. Not checked: Vercel's own launcher and a real `vercel deploy` (need an account). |

All four need the app built to plain JavaScript first (Rolldown or `tsc`), because the providers' own bundlers compile TypeScript with esbuild and drop decorator metadata.

## Database

| | Status | Evidence |
|---|---|---|
| PostgreSQL 18 | Supported | CI: `@blixis-io/db` and `@blixis-io/tenancy` test against a real `postgres:18-alpine`. |
| Other versions and databases | Not tested | |

If you rely on something marked *Not tested* and it works (or doesn't), a report on the [issue tracker](https://github.com/blixis-io/framework/issues) turns it into a verified row.
