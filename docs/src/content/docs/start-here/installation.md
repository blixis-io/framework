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
