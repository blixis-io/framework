---
title: Modules
description: "@Module, imports, dynamic modules, and how the application graph is built."
sidebar:
  order: 3
---

`@blixis-io/core` groups providers and controllers into modules, and modules into an import graph, so you write one `@Module({...})` per feature instead of registering every provider directly on a `Container` yourself.

## `@Module`

```ts
import { Module } from "@blixis-io/core";

@Module({
  imports: [DatabaseModule],
  providers: [PostService, PostRepository],
  controllers: [PostController],
})
export class PostsModule {}
```

All fields are optional and default to empty. `providers` and `controllers` are exactly what you'd pass to `Container.register()` directly — bare classes or the provider-shape objects described in [Dependency Injection](/framework/concepts/dependency-injection/). `imports` lists other modules whose *exported* providers this module's own providers/controllers can depend on — see [encapsulation](#encapsulation-exports-and-global) below.

## Building an application from a root module

```ts
import { createApplication } from "@blixis-io/core";

const app = await createApplication(AppModule);

app.get(PostService); // an already-resolved singleton
app.controllers;      // every controller class collected from the graph
await app.close();    // runs OnApplicationShutdown hooks, in reverse dependency order
```

`createApplication` walks the import graph starting from `AppModule`, flattens every module's providers and controllers into one `Container`, resolves everything eagerly, and runs `OnModuleInit` hooks in dependency order (see [Lifecycle Hooks](/framework/concepts/lifecycle-hooks/)). `@blixis-io/http`'s `createHttpApplication` wraps this same function — see [Routing & Controllers](/framework/concepts/routing-controllers/).

If a class listed as an import isn't actually decorated with `@Module()`, this throws `NotAModuleError` naming the class.

## Diamond imports are deduplicated

If two modules both import a third, shared module, that shared module's providers are only registered once — by module identity, not by provider token:

```ts
@Module({ providers: [Cache] })
class CacheModule {}

@Module({ imports: [CacheModule] })
class FeatureA {}

@Module({ imports: [CacheModule] })
class FeatureB {}

@Module({ imports: [FeatureA, FeatureB] })
class AppModule {}
```

`CacheModule` is visited once regardless of how many other modules import it; `Cache` ends up registered exactly once, not twice (which would otherwise throw `DuplicateProviderError`).

## Encapsulation: `exports` and `global`

Registering a provider in a module doesn't automatically make it available to *other* modules — only to things declared in that same module, unless it's explicitly exported:

```ts
@Injectable()
class Cache {}

@Module({ providers: [Cache], exports: [Cache] })
class CacheModule {}

@Injectable()
class PostService {
  constructor(public cache: Cache) {} // ok: CacheModule exports Cache, and this module imports CacheModule
}

@Module({ imports: [CacheModule], providers: [PostService] })
class PostsModule {}
```

Drop `exports: [Cache]` from `CacheModule`, or `imports: [CacheModule]` from `PostsModule`, and building the application throws `ProviderNotVisibleError` — naming exactly what's missing and which module owns the token:

```
PostService depends on Cache, but that belongs to CacheModule, which doesn't export it.
Add it to CacheModule's exports, or import CacheModule into PostService's own module.
```

This is checked for every dependency shape — a class's constructor, a factory provider's `inject` list, a `useExisting` alias target — and for controllers exactly the same as providers. It's a **static check**, run once while the application is being built, before anything resolves — the same fail-fast philosophy as [Configuration](/framework/concepts/config/)'s `ConfigValidationError`.

A dependency that doesn't exist *anywhere* in the whole graph is a different problem (`MissingProviderError`, or `undefined` for an `@Optional()` one) — encapsulation only fires for a token that's real, just not visible from here. Notably, `@Optional()` does **not** suppress a visibility violation: if the token exists but is private to another module, that's a real configuration mistake worth surfacing loudly, not a "maybe this wasn't registered" situation `@Optional()` is meant to handle.

### `global: true`

Requiring every feature module to explicitly import cross-cutting infra like logging or config would get old fast. A module marked `global: true` has its exports visible to **every** module in the graph, with no import required:

```ts
@Module({ providers: [Cache], exports: [Cache], global: true })
class CacheModule {}
```

Both [`@blixis-io/logging`](/framework/concepts/logging/)'s `LoggerModule` and [`@blixis-io/config`](/framework/concepts/config/)'s `ConfigModule` are `global: true` for exactly this reason — see either one's `forRoot()` for a real example, and `examples/hello-api` for it working end to end (`PostsService` injects `LOGGER` without `PostsModule` importing `LoggerModule` at all).

Use `global` sparingly — it's the right call for genuinely app-wide infrastructure, not a way to skip thinking about a feature module's own boundaries.

## Dynamic modules: the `forRoot()` pattern

A module class's own `@Module()` metadata is static — decided once, at class-definition time. For a module that needs *runtime* configuration (a database connection string, a feature flag), return a `DynamicModule` object instead of the class:

```ts
import type { DynamicModule } from "@blixis-io/core";

@Module()
export class ConfigModule {
  static forRoot(config: { name: string }): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: CONFIG, useValue: config }],
    };
  }
}

@Module({ imports: [ConfigModule.forRoot({ name: "blixis" })] })
class AppModule {}
```

The dynamic module's `providers`/`controllers`/`imports` are merged with (added to, not replacing) whatever `ConfigModule`'s own static `@Module()` declares. Deduplication is still by the underlying module *class* (`ConfigModule`), not by the specific dynamic configuration passed — importing `ConfigModule.forRoot(a)` and `ConfigModule.forRoot(b)` from two different places registers only the first one's providers, a known v1 limitation worth knowing if you reach for this pattern.

## Overriding providers (mainly for tests)

`createApplication` accepts an `overrides` list — providers that replace the module graph's own registration for the same token, applied before anything resolves:

```ts
await createApplication(AppModule, {
  overrides: [{ provide: PostRepository, useValue: fakeRepo }],
});
```

You'll rarely call this directly; it's what `@blixis-io/testing`'s `.override()` is built on. See [Testing](/framework/concepts/testing/) and [Overriding Providers in Tests](/framework/guides/overriding-providers-in-tests/).

## Next

- What happens to each provider as the graph resolves: [Lifecycle Hooks](/framework/concepts/lifecycle-hooks/).
- Turning `controllers` into actual HTTP routes: [Routing & Controllers](/framework/concepts/routing-controllers/).
- Every exported symbol: [`@blixis-io/core` reference](/framework/reference/blixis-core/).
