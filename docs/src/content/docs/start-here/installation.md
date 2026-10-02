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

This writes a runnable app (service, controller, module, `main.ts`, and a `tsconfig.json` with the settings below), installs `@blixis-io/core`, `@blixis-io/di`, `@blixis-io/http`, `typescript`, `@types/node` and `concurrently`, and tells you how to run it. `pnpm dev` compiles with `tsc` and then recompiles on every change while Node restarts on the new output (no `tsx`: it can't emit decorator metadata). It detects pnpm, npm, yarn or bun from how you invoked it (`npm create blixis@latest my-app` works too); pass `--no-install` to only write the files. The [Quickstart](/framework/start-here/quickstart/) builds the same app by hand.

To set up deployment at the same time, add `--deploy <target>` (`docker`, `vercel`, `netlify` or `cloudflare`) and, optionally, `--ci <provider>` (`github`, `gitlab` or `bitbucket`):

```bash
pnpm create blixis my-app --deploy docker --ci github
```

That also installs `@blixis-io/cli` and `@blixis-io/deploy` and runs [`blix deploy init`](/framework/guides/deploying/) for you, so the project comes with its deploy config, the files that target needs, and the pipeline. If that last step fails the app is still created, and you can run `blix deploy init` yourself.

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

Mixed versions are the real hazard when this bites: if `@blixis-io/http` updates but `@blixis-io/core` stays behind, you can end up with two copies of core. Current releases fail loudly in that case. See [Two copies of core or di](/framework/architecture/toolchain-notes/#two-copies-of-blixis-iocore-or-blixis-iodi).

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
