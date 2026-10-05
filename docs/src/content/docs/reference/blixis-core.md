---
title: "@blixis-io/core"
description: Full API reference for the module system and application bootstrap package.
sidebar:
  order: 2
---

The module system: `@Module`, dynamic modules, lifecycle hook interfaces, and `Application`. See [Modules](/framework/concepts/modules/) and [Lifecycle Hooks](/framework/concepts/lifecycle-hooks/) for the concepts.

## `@Module`

```ts
function Module(metadata?: ModuleMetadata): ClassDecorator;

interface ModuleMetadata {
  imports?: ModuleRef[];
  providers?: Provider[];
  controllers?: Class[];
  /** Tokens (from `providers`) visible to modules that directly import this one. */
  exports?: Token[];
  /** Makes every exported token visible to every module in the graph, no import required. */
  global?: boolean;
}

type ModuleRef = Class | DynamicModule;

interface DynamicModule extends ModuleMetadata {
  module: Class;
}
```

All metadata fields default to empty/`false`. `providers`/`controllers` accept exactly what `@blixis-io/di`'s `Container.register()` does (see [`@blixis-io/di` reference](/framework/reference/blixis-di/#provider-shapes)). A `DynamicModule`'s own fields are merged with (added to, not replacing) the `module` class's own static `@Module()` metadata — see [Using Dynamic Modules](/framework/guides/using-dynamic-modules/). `exports`/`global` are enforced — see [Modules](/framework/concepts/modules/#encapsulation-exports-and-global) for the full behavior and error message.

### Metadata readers

```ts
function getModuleMetadata(target: object): ModuleMetadata | undefined;
function isDynamicModule(ref: ModuleRef): ref is DynamicModule;
function moduleClassOf(ref: ModuleRef): Class;
```

## `Application`

```ts
class Application {
  readonly controllers: readonly Class[];
  static create(rootModule: ModuleRef, options?: CreateApplicationOptions): Promise<Application>;
  get<T>(token: Token<T>): T;
  resolved(): ReadonlyArray<readonly [Token, unknown]>; // every singleton instance + its token, in dependency order
  close(signal?: string): Promise<void>;
}

interface OnApplicationBootstrap {
  onApplicationBootstrap(app: BootstrapContext): void | Promise<void>; // after all onModuleInit; for discovery
}

interface BootstrapContext {
  resolved(): ReadonlyArray<readonly [Token, unknown]>;
  get<T>(token: Token<T>): T;
}

interface CreateApplicationOptions {
  overrides?: Provider[]; // replace a provider from the module graph before resolution, matched by token
}

function createApplication(rootModule: ModuleRef, options?: CreateApplicationOptions): Promise<Application>;
```

`createApplication` (or `Application.create`, identical) walks the module graph from `rootModule`, flattens every module's providers/controllers into one `Container`, resolves everything, and runs every `OnModuleInit` hook in dependency order. `controllers` is every controller class collected from the graph — `@blixis-io/http`'s `createHttpApplication` uses it to build the router.

`close(signal?)` runs every `OnApplicationShutdown` hook in reverse dependency order, passing `signal` through unchanged. A failing hook does not stop the others: one failure is rethrown as it is, several as an `AggregateError`. **Idempotent** — a second call is a no-op, not a second run of every hook. If creating the application fails part-way, `createApplication` first shuts down the providers it had built (see [Lifecycle Hooks](/framework/concepts/lifecycle-hooks/#when-boot-fails)) and rejects with the original error.

If a class listed in `imports` isn't itself `@Module()`-decorated, building the application throws `NotAModuleError` naming that class.

## Lifecycle hook interfaces

```ts
interface OnModuleInit {
  onModuleInit(): void | Promise<void>;
}

interface OnApplicationShutdown {
  onApplicationShutdown(signal?: string): void | Promise<void>;
}

function hasOnModuleInit(instance: unknown): instance is OnModuleInit;
function hasOnApplicationShutdown(instance: unknown): instance is OnApplicationShutdown;
```

Any provider implementing either interface is picked up automatically — there's no separate registration. See [Lifecycle Hooks](/framework/concepts/lifecycle-hooks/) for the ordering guarantees.

## Errors

```ts
class CoreError extends Error {}

class NotAModuleError extends CoreError {}
// "{ClassName} is not a module — did you forget @Module()?"

class ProviderNotVisibleError extends CoreError {}
// "{Consumer} depends on {Token}, but that belongs to {Module}, which doesn't
//  export it. Add it to {Module}'s exports, or import {Module} into
//  {Consumer}'s own module."
```

`ProviderNotVisibleError` fires when a provider or controller depends on a token that exists somewhere in the module graph but isn't visible to its own module — see [Modules](/framework/concepts/modules/#encapsulation-exports-and-global).
