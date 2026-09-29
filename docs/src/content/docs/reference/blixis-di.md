---
title: "@blixis/di"
description: Full API reference for the dependency injection package.
sidebar:
  order: 1
---

The dependency injection container: `Container`, decorators, tokens, providers, and the errors the container can throw. See [Dependency Injection](/concepts/dependency-injection/) for the concepts; this page is the exhaustive signature-level reference.

## Container

### `class Container`

```ts
class Container {
  register<T>(provider: Provider<T>): void;
  resolve<T>(token: Token<T>): Promise<T>;
  get<T>(token: Token<T>): T;
  getResolvedEntries(): ReadonlyArray<readonly [Token, unknown]>;
  resolveAll(): Promise<void>;
}
```

- **`register(provider)`** — registers a provider (see [Provider shapes](#provider-shapes) below). Throws `DuplicateProviderError` if the resulting token is already registered.
- **`resolve(token)`** — resolves a token, building its full dependency graph as needed. Async because factories may be async and because building deep graphs takes real awaits. Singleton instances are cached and memoized against concurrent resolution — see [Dependency Injection](/concepts/dependency-injection/#singletons-are-memoized-against-concurrent-resolution).
- **`get(token)`** — synchronous lookup of an *already-resolved* singleton. Throws `ProviderNotResolvedError` if `resolve()` hasn't been called for that token yet (or if it's a transient provider, which is never cached).
- **`getResolvedEntries()`** — every resolved singleton, `[token, instance]` pairs, in the order they finished constructing (dependencies before dependents). This is what `@blixis/core` uses to run lifecycle hooks in the correct order. Transient instances never appear here.
- **`resolveAll()`** — resolves every registered provider. Safe to run concurrently across providers that share dependencies (see the memoization note above).

## Dependency introspection

```ts
function getDependencyTokens(ctor: Class): DependencyDescriptor[];

interface DependencyDescriptor {
  readonly index: number;
  readonly token: Token;
  readonly optional: boolean;
}
```

Computes what a class's constructor parameters resolve to — the same reflection `Container` uses internally to build instances — without instantiating anything. Throws the same `NotInjectableError`/`UnresolvableParameterError` a real resolution would. `@blixis/core` uses this to validate module `exports`/encapsulation (see [Modules](/concepts/modules/#encapsulation-exports-and-global)) before anything resolves; it's exported for any other tooling that needs to inspect a dependency graph statically.

## Decorators

### `Injectable(options?)`

```ts
function Injectable(options?: { scope?: "singleton" | "transient" }): ClassDecorator;
```

Marks a class as constructible by the container and required for TypeScript to emit its constructor's parameter types at all — see [Decorators & Metadata](/concepts/decorators-and-metadata/). Defaults to `scope: "singleton"`.

### `Inject(token)`

```ts
function Inject(token: Token | ForwardRef): ParameterDecorator;
```

Overrides the reflected type of one constructor parameter — required for any parameter whose type is an `InjectionToken`, an interface, or a `forwardRef()`.

### `Optional()`

```ts
function Optional(): ParameterDecorator;
```

Marks a constructor parameter as resolving to `undefined`, instead of throwing `MissingProviderError`, when nothing is registered for it. Doesn't suppress `UnresolvableParameterError` or `CircularDependencyError`.

### Metadata readers

```ts
function getInjectableOptions(target: object): { scope: "singleton" | "transient" } | undefined;
function getInjectOverrides(target: object): Map<number, TokenRef> | undefined;
function getOptionalParams(target: object): Set<number> | undefined;
```

Read back what the three decorators above stored. Mostly useful if you're building your own decorators on top of `@blixis/di`'s container (the way `@blixis/core` and `@blixis/http` do).

## Tokens

### `class InjectionToken<T>`

```ts
class InjectionToken<T> {
  constructor(description: string);
  readonly description: string;
  toString(): string; // "InjectionToken(description)"
}
```

An identity for injecting something that isn't itself a class — config, primitives, anything shaped by an interface. Two tokens with the same `description` are still distinct instances (identity-based, like `Symbol`).

### `type Token<T>`

```ts
type Token<T> = Class<T> | AbstractClass<T> | InjectionToken<T>;
```

Anything `register`/`resolve`/`Inject` accept as an identity: a concrete class, an `abstract class` used purely as a type-token, or an `InjectionToken`.

### `type Class<T>` / `type AbstractClass<T>`

```ts
type Class<T = unknown> = new (...args: never[]) => T;
type AbstractClass<T = unknown> = abstract new (...args: never[]) => T;
```

`Class` is used for `useClass`/bare-class providers (must be concrete — you can't `new` an abstract class). `AbstractClass` extends what counts as a valid `Token`, for the Angular-style "provide an interface" pattern (see [Dependency Injection](/concepts/dependency-injection/#tokens-injecting-something-that-isnt-a-class)).

### `tokenName(token)`

```ts
function tokenName(token: Token): string;
```

A human-readable name for a token — a class's `.name`, or an `InjectionToken`'s `toString()`. Used internally to build every DI error message.

## Provider shapes

### `type Provider<T>`

```ts
type Provider<T> =
  | Class<T>                                            // shorthand for { provide: T, useClass: T }
  | { provide: Token<T>; useClass: Class<T> }
  | { provide: Token<T>; useValue: T }
  | { provide: Token<T>; useFactory: (...args) => T | Promise<T>; inject?: TokenRef[] }
  | { provide: Token<T>; useExisting: TokenRef<T> };
```

The five shapes `register()` accepts. `ClassProvider<T>`, `ValueProvider<T>`, `FactoryProvider<T>`, `ExistingProvider<T>` are each exported individually as well, for typing your own helpers that build providers.

### `type Scope`

```ts
type Scope = "singleton" | "transient";
```

### Type guards and helpers

```ts
function isBareClassProvider(provider: Provider): provider is Class;
function isClassProvider(provider: object): provider is ClassProvider;
function isValueProvider(provider: object): provider is ValueProvider;
function isFactoryProvider(provider: object): provider is FactoryProvider;
function isExistingProvider(provider: object): provider is ExistingProvider;
function providerToken(provider: Provider): Token; // the token a provider registers under, whichever shape it is
```

## `forwardRef`

```ts
function forwardRef<T>(resolver: () => Token<T>): ForwardRef<T>;
function isForwardRef(value: unknown): value is ForwardRef;
function unwrapForwardRef<T>(ref: TokenRef<T>): Token<T>;
type TokenRef<T> = Token<T> | ForwardRef<T>;
```

Defers resolving a token reference until it's actually needed — see [Dependency Injection](/concepts/dependency-injection/#forwardref-for-circular-references) for why this is necessary for genuinely circular class references, and the important caveat about typing the parameter `unknown` rather than the forward-referenced class itself.

## Errors

Every error extends `DiError extends Error`.

```ts
class NotInjectableError extends DiError {}
// "{ClassName} has constructor parameters but is missing @Injectable() —
//  decorator metadata is only emitted for decorated classes."

class UnresolvableParameterError extends DiError {}
// "Parameter #{index} of {ClassName} is Object|undefined —
//  add @Inject(token) or import the class as a value."

class MissingProviderError extends DiError {
  readonly chain: readonly string[]; // e.g. ["PostController", "PostService", "Database"]
}
// 'No provider for "Database" (resolution path: PostController -> PostService -> Database)'

class CircularDependencyError extends DiError {
  readonly chain: readonly string[]; // the cycle, e.g. ["A", "B", "A"]
}
// "Circular dependency detected: A -> B -> A"

class ProviderNotResolvedError extends DiError {}
// "{tokenName} has not been resolved yet — call resolve() before get()."

class DuplicateProviderError extends DiError {}
// "A provider for {tokenName} is already registered."
```

Every message is designed to name the exact problem and the exact fix — see [Dependency Injection](/concepts/dependency-injection/) for when each one fires in practice.

## Metadata helpers

Low-level `Reflect.metadata` wrappers, used internally and by `@blixis/core`/`@blixis/http` to build their own decorators on the same foundation — see [Decorators & Metadata](/concepts/decorators-and-metadata/).

```ts
function defineMetadata(key: MetadataKey, value: unknown, target: object, propertyKey?: MetadataKey): void;
function getMetadata<T>(key: MetadataKey, target: object, propertyKey?: MetadataKey): T | undefined;
function getOwnMetadata<T>(key: MetadataKey, target: object, propertyKey?: MetadataKey): T | undefined;
type MetadataKey = string | symbol;
```

`getOwnMetadata` doesn't see metadata inherited from a parent class (via `Reflect.getOwnMetadata` rather than `Reflect.getMetadata`); `getMetadata` does.
