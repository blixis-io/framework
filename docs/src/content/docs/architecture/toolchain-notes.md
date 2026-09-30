---
title: Toolchain Notes & Gotchas
description: TypeScript 7 / tsgo, Vitest + Oxc, and the specific failure modes the framework's error messages guard against.
sidebar:
  order: 2
---

Blixis was built against TypeScript's new Go-native compiler (internally codenamed Corsa, shipped as `tsc`/`tsgo`) from the start. This page documents what actually works, what to configure, and the specific ways decorator metadata can silently go wrong — most of it learned by hitting it directly during the framework's own development.

## TypeScript 7: what's actually verified

TypeScript 7.0 replaced the JavaScript compiler with a native Go binary, shipping as the standard `tsc` command (the `tsgo` name was the preview-era binary; in the stable 7.0 release it's just `tsc`). Legacy decorator emit and `emitDecoratorMetadata` support landed in the native port, and has had targeted fixes since (symbol-named decorated methods, `bigint` metadata on pre-ES2020 targets) — by the time of this framework's development, both were confirmed working end-to-end: a decorated class compiled with `tsc` correctly produces `design:paramtypes` metadata, verified directly against a real compiled-and-executed fixture, not just assumed from release notes.

One real limitation worth planning around: **TypeScript 7.0 shipped without a stable programmatic API.** Tools that import `typescript` as a library rather than shelling out to `tsc` — API-documentation generators, some editor tooling, `typescript-eslint`'s type-aware rules in certain configurations — don't yet work against TS7 and need their own pinned TypeScript 5.x/6.x dependency in the meantime. It's exactly why this documentation site's own API reference pages ([`@blixis-io/di`](/reference/blixis-di/) and friends) are hand-written rather than generated — [TypeDoc](https://typedoc.org) peer-depends on TypeScript 5.x/6.x, not 7.x.

## Vitest + Oxc: the flags aren't optional, and they're not read from `tsconfig.json`

Vite 8 (and therefore Vitest 5) transforms TypeScript via **Oxc**, a separate, independent implementation from both `tsc` and esbuild. Oxc supports legacy decorators and metadata emission, but you have to tell it to, explicitly, in your Vite/Vitest config:

```ts
export default defineConfig({
  oxc: {
    decorator: {
      legacy: true,
      emitDecoratorMetadata: true,
    },
  },
});
```

Oxc does **not** read `experimentalDecorators`/`emitDecoratorMetadata` out of `tsconfig.json` the way `tsc` does. Miss this configuration and every test touching DI resolution fails with `NotInjectableError` or `UnresolvableParameterError` on classes that compile and run fine with `tsc` — the failure looks like a container bug, but it's a transform configuration gap.

**esbuild-based tooling (`tsx`, older Vite defaults) doesn't support `emitDecoratorMetadata` at all** — there's no flag, no workaround. If your dev or test pipeline goes through esbuild, DI resolution is broken for any class with constructor parameters, full stop.

## Oxc is per-file: the `Object` fallback

Both `tsc` and Oxc erase an unresolvable parameter type to the `Object` constructor in `design:paramtypes` — an interface, a union type, or (specific to Oxc, which transforms each file independently without cross-file type inference) a type imported from another file that Oxc simply hasn't resolved. This is exactly the failure mode `@blixis-io/di`'s `UnresolvableParameterError` exists to catch and explain, rather than leaving you to debug a container that silently tried to resolve the `Object` constructor as a provider token.

## The one case that erases to `undefined`, not `Object`

Verified directly against `tsc` 7's actual output: a constructor parameter typed `void` produces a literal `undefined` entry in `design:paramtypes`, not `Object`. Every other unresolvable case (interfaces, unions, rest parameters typed as an array, `any`) erases to `Object` or the relevant concrete constructor. `UnresolvableParameterError`'s message distinguishes the two (`"is Object"` vs. `"is undefined"`) because they come from genuinely different situations, even though the fix is the same either way.

## The metadata-key convention that's easy to get backwards

Covered in depth in [Decorators & Metadata](/concepts/decorators-and-metadata/#the-rule-thats-easy-to-get-backwards-key-by-what-the-decorator-receives): method-scoped `reflect-metadata` calls must be keyed by the class **prototype** (exactly what a method or parameter decorator's `target` argument already is), never `target.constructor`. Writing metadata against one and reading it back against the other doesn't throw — it just silently returns `undefined`, as if the metadata was never set. This bit the framework's own test suite once during development (three failing tests, immediately obvious once traced) and is worth checking first if a custom decorator you write seems to have no effect.

## Circular class references and `design:paramtypes`'s eager evaluation

`design:paramtypes` is computed **eagerly**, at class-decoration time — the compiler emits something like `__metadata("design:paramtypes", [Dep])` immediately after the class body, evaluating `Dep` as a value right then. If `Dep` is a class declared *later* in the same module and directly used as a constructor parameter's *type*, this throws a `ReferenceError` (temporal dead zone) before your code — or `@blixis-io/di`'s `forwardRef` — ever gets involved. `forwardRef` fixes the *injection* side (deferring which token to resolve), but it can't fix an eager metadata-emission crash that happens before any of your runtime code executes. The workaround, and the reason [Dependency Injection](/concepts/dependency-injection/#forwardref-for-circular-references) insists on it: type the parameter `unknown`, not the forward-referenced class, and let `@Inject(forwardRef(() => Dep))` carry the actual token.
