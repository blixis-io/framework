---
title: Modules
description: "@Module, imports, dynamic modules, and how the application graph is built."
sidebar:
  order: 3
---

`@blixis/core` groups providers and controllers into modules, and modules into an import graph, so you write one `@Module({...})` per feature instead of registering every provider directly on a `Container` yourself.

## `@Module`

```ts
import { Module } from "@blixis/core";

@Module({
  imports: [DatabaseModule],
  providers: [PostService, PostRepository],
  controllers: [PostController],
})
export class PostsModule {}
```

All three fields are optional and default to empty. `providers` and `controllers` are exactly what you'd pass to `Container.register()` directly — bare classes or the provider-shape objects described in [Dependency Injection](/concepts/dependency-injection/). `imports` lists other modules whose providers this module's own providers/controllers can depend on.

## Building an application from a root module

```ts
import { createApplication } from "@blixis/core";

const app = await createApplication(AppModule);

app.get(PostService); // an already-resolved singleton
app.controllers;      // every controller class collected from the graph
await app.close();    // runs OnApplicationShutdown hooks, in reverse dependency order
```

`createApplication` walks the import graph starting from `AppModule`, flattens every module's providers and controllers into one `Container`, resolves everything eagerly, and runs `OnModuleInit` hooks in dependency order (see [Lifecycle Hooks](/concepts/lifecycle-hooks/)). `@blixis/http`'s `createHttpApplication` wraps this same function — see [Routing & Controllers](/concepts/routing-controllers/).

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

## Dynamic modules: the `forRoot()` pattern

A module class's own `@Module()` metadata is static — decided once, at class-definition time. For a module that needs *runtime* configuration (a database connection string, a feature flag), return a `DynamicModule` object instead of the class:

```ts
import type { DynamicModule } from "@blixis/core";

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

You'll rarely call this directly; it's what `@blixis/testing`'s `.override()` is built on. See [Testing](/concepts/testing/) and [Overriding Providers in Tests](/guides/overriding-providers-in-tests/).

## Next

- What happens to each provider as the graph resolves: [Lifecycle Hooks](/concepts/lifecycle-hooks/).
- Turning `controllers` into actual HTTP routes: [Routing & Controllers](/concepts/routing-controllers/).
- Every exported symbol: [`@blixis/core` reference](/reference/blixis-core/).
