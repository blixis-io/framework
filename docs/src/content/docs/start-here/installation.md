---
title: Installation
description: Requirements and workspace setup for building on Blixis.
sidebar:
  order: 2
---

## Requirements

- **Node.js 24+**. The framework targets `es2023` and uses Node's built-in `fetch`/`Request`/`Response`/`Headers` globals directly — no polyfills.
- **A package manager**: pnpm, npm, yarn or bun all work. The framework repo itself uses pnpm 11+.
- **TypeScript 7** (the native `tsc` / `tsgo` compiler). Verified working with `typescript@7.0.2` and later.

## Fastest start

```bash
pnpm create blixis my-app
```

This writes a runnable app (service, controller, module, `main.ts`, and a `tsconfig.json` with the settings below), installs `@blixis-io/core`, `@blixis-io/di`, `@blixis-io/http`, `zod`, `typescript` and `@types/node`, and tells you how to run it. `pnpm dev` runs `scripts/dev.mjs`, a short script it wrote into the app: it compiles with `tsc` and then recompiles on every change while Node restarts on the new output (no `tsx`: it can't emit decorator metadata). There is no process-runner dependency to keep up to date, and the script is yours to change. It detects pnpm, npm, yarn or bun from how you invoked it (`npm create blixis@latest my-app` works too); pass `--no-install` to only write the files. The [Quickstart](/framework/start-here/quickstart/) builds the same app by hand.

To set up deployment at the same time, add `--deploy <target>` (`docker`, `vercel`, `netlify` or `cloudflare`) and, optionally, `--ci <provider>` (`github`, `gitlab` or `bitbucket`):

```bash
pnpm create blixis my-app --deploy docker --ci github
```

That also installs `@blixis-io/cli` and `@blixis-io/deploy` and runs [`blix deploy init`](/framework/guides/deploying/) for you, so the project comes with its deploy config, the files that target needs, and the pipeline. If that last step fails the app is still created, and you can run `blix deploy init` yourself.

## Peer dependencies: install what you build on

The framework packages share state (decorator metadata, the DI container, `RequestContext`, Zod schemas), so a second copy of any of them breaks things. To guarantee one copy, the packages that build on another one declare it as a **peer dependency** instead of bundling their own: your project installs it once, and every package uses that one.

| Package | Install these alongside it |
| --- | --- |
| `@blixis-io/core` | `@blixis-io/di` |
| `@blixis-io/http` | `@blixis-io/core`, `@blixis-io/di`, `zod` |
| `@blixis-io/auth`, `@blixis-io/tenancy`, `@blixis-io/testing` | `@blixis-io/http` (so also core, di, zod) |
| `@blixis-io/openapi` | `@blixis-io/http`, `@blixis-io/di`, `zod` |
| `@blixis-io/config` | `@blixis-io/core`, `@blixis-io/di`, `zod` |
| `@blixis-io/events`, `@blixis-io/logging` | `@blixis-io/core`, `@blixis-io/di` |
| `@blixis-io/db`, `@blixis-io/tenancy` | `drizzle-orm` (plus `pg` for db) |
| `@blixis-io/commands`, `@blixis-io/deploy` | `@blixis-io/cli`; commands also `@blixis-io/core` and `@blixis-io/di` |

pnpm and npm 7+ install missing peers for you; yarn and bun may only warn, so add them yourself (each package's README has the exact install line). `pnpm create blixis` installs them for you.

One thing to know about pnpm: a peer it installs for you is available to the package that needs it, not to **your own code**. If your app imports `@blixis-io/http`, `@blixis-io/core` or `zod` directly (it almost certainly does), add them to your own `dependencies`; otherwise the import fails with `Cannot find package`.

If a peer range doesn't fit what you have, for example `@blixis-io/auth` 0.4 next to `@blixis-io/core` 0.3: npm refuses with `ERESOLVE` and names the conflict. **pnpm 11 only warns** ("Issues with peer dependencies found") and installs anyway; `pnpm peers check` lists what doesn't match. Upgrade the framework packages together (`pnpm update "@blixis-io/*" --latest`) and the ranges line up.

## pnpm 11 skips versions younger than 24 hours

pnpm 11 ignores any package version published in the last 24 hours (its `minimumReleaseAge` default is a supply-chain safeguard), and fails if a lockfile pins one. You will notice it in the first day after a Blixis release:

- `pnpm create blixis` and `pnpm add @blixis-io/...` quietly pick the **previous** versions.
- `pnpm install --frozen-lockfile` (in CI, in a Docker build, or inside Vercel's build) fails with:

```
[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 7 lockfile entries failed verification:
  @blixis-io/core@0.2.1 was published at ..., within the minimumReleaseAge cutoff (...)
```

It clears by itself after 24 hours. To skip the wait for Blixis packages only, and leave the safeguard on for everything else, exclude our scope in `pnpm-workspace.yaml`:

```yaml title="pnpm-workspace.yaml"
minimumReleaseAgeExclude:
  - "@blixis-io/*"
```

This was checked with pnpm 11.25.0: with the line present, the lockfile passes the default policy and a `vercel build` that runs its own `pnpm install` succeeds. For a single command, `pnpm --config.minimumReleaseAge=0 add ...` turns the gate off for that run. npm, yarn and bun have no such default.

Mixed versions are the real hazard when this bites: if `@blixis-io/http` updates but `@blixis-io/core` stays behind, the peer range no longer fits and the install reports the conflict. Before peer dependencies (releases up to and including http 0.5.0 and its siblings), the same mix silently produced two copies of core, which fail loudly at import. See [Two copies of core or di](/framework/architecture/toolchain-notes/#two-copies-of-blixis-iocore-or-blixis-iodi).

## The one non-negotiable compiler setting

Blixis uses **legacy decorators**, not the newer TC39 decorators — see [Why Legacy Decorators](/framework/architecture/why-legacy-decorators/) for why. Your `tsconfig.json` must have:

```json title="tsconfig.json"
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false
  }
}
```

Without `emitDecoratorMetadata`, constructor injection silently can't see parameter types at all — `@blixis-io/di` will throw `NotInjectableError` for every class with constructor parameters, because TypeScript only emits `design:paramtypes` metadata for a class that's decorated with at least one class decorator (which `@Injectable()` provides).

`useDefineForClassFields: false` matters because legacy decorator semantics expect class fields to be assigned the old (`Object.defineProperty`-free) way; leaving it at the ES2022+ default breaks decorator field initialization order.

### If you're running tests with Vitest

Vite 8 (and therefore Vitest 5) transforms TypeScript through **Oxc**, not the TypeScript compiler — Oxc needs the same two decorator flags set explicitly in your Vite/Vitest config, because it doesn't read them from `tsconfig.json`:

```ts title="vitest.config.ts"
import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    decorator: {
      legacy: true,
      emitDecoratorMetadata: true,
    },
  },
});
```

Skip this and your tests will fail in confusing ways — usually `NotInjectableError` or `UnresolvableParameterError` on classes that work fine when compiled with `tsc`, because Oxc silently emitted no metadata (or the fallback `Object` type) instead. See [Toolchain Notes & Gotchas](/framework/architecture/toolchain-notes/) for the full story.

### If you're using esbuild-based tooling (tsx, older Vite)

Don't. `esbuild` does not support `emitDecoratorMetadata` at all — there's no flag to turn on. If your dev/test tooling goes through esbuild, DI resolution will fail for any class with a constructor. Vitest 5 on Vite 8 (via Oxc, as above) and `tsc` are the two verified-working paths.

## Dependencies

The `@blixis-io/di` package depends on [`reflect-metadata`](https://www.npmjs.com/package/reflect-metadata) (imported once, as a side effect, by its own entry point — you never import it yourself). `@blixis-io/http` depends on [`zod`](https://zod.dev) for request validation; any Zod v4 schema works with `@Body`/`@Query`/`@Param`.

## Next

Continue to the [Quickstart](/framework/start-here/quickstart/) to see all of this wired together in a runnable example.
