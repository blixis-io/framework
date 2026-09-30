---
title: Dependency Injection
description: The Container, @Injectable, @Inject, tokens, scopes, and forwardRef.
sidebar:
  order: 1
---

`@blixis-io/di` resolves a graph of classes from their constructor parameter types, using nothing but a class decorator and TypeScript's own `emitDecoratorMetadata` output. There's no `reflect-metadata` call you have to make yourself, no manual registration of "what implements what" beyond registering the provider itself.

## The container

A `Container` holds providers and the instances built from them.

```ts
import { Container, Injectable } from "@blixis-io/di";

@Injectable()
class Database {}

@Injectable()
class UserRepository {
  constructor(public db: Database) {}
}

const container = new Container();
container.register(Database);
container.register(UserRepository);

const repo = await container.resolve(UserRepository);
repo.db; // a Database instance, built automatically
```

`resolve()` is async because building the graph might involve async factories (below). `register()` is synchronous and throws `DuplicateProviderError` if you register the same token twice.

In an HTTP app you never call `register`/`resolve` directly — `@blixis-io/core`'s `@Module` does it for you from a declarative provider list. This page covers what's actually happening underneath that.

## `@Injectable()` is required, not decoration

```ts
@Injectable()
class UserRepository {
  constructor(public db: Database) {}
}
```

This is easy to misread as optional metadata. It isn't: **TypeScript only emits `design:paramtypes` (the array of constructor parameter types) for a class that carries at least one class decorator.** An undecorated class with constructor parameters has *no* reflectable type information at all — the container can't tell how many parameters it even has, let alone what type each one is.

If you register a class with constructor parameters and no `@Injectable()`, resolving it throws `NotInjectableError`. A zero-parameter class works fine either way, since there's nothing to reflect.

`@Injectable(options?)` also sets the provider's scope:

```ts
@Injectable({ scope: "transient" })
class RequestLogger {}
```

- **`"singleton"`** (the default) — built once, the same instance returned on every resolution.
- **`"transient"`** — a new instance every time it's resolved, never cached.

## Constructor injection

Each constructor parameter is resolved by its reflected type:

```ts
@Injectable()
class PostService {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}
}
```

Both `Database` and `Logger` are looked up in the container by their class identity and resolved recursively — dependencies of dependencies, however deep, in whatever order they need to be built.

### When the reflected type isn't a class

An interface, a union type, or a circular import all erase to `Object` at runtime — there's no value for `design:paramtypes` to point at. Resolving a class with such a parameter throws `UnresolvableParameterError`, naming the exact parameter:

```
Parameter #0 of UserService is Object — add @Inject(token) or import the class as a value.
```

The one other case worth knowing: a parameter typed `void` reflects as a literal `undefined`, not `Object` — same fix, different message (`... is undefined — ...`). See [Toolchain Notes & Gotchas](/architecture/toolchain-notes/) for why.

## Tokens: injecting something that isn't a class

Use `InjectionToken<T>` for config values, primitives, or anything that isn't itself a constructible class:

```ts
import { InjectionToken } from "@blixis-io/di";

interface AppConfig {
  port: number;
}

export const APP_CONFIG = new InjectionToken<AppConfig>("app.config");
```

Register a value against it and inject it with `@Inject`:

```ts
container.register({ provide: APP_CONFIG, useValue: { port: 3000 } });

@Injectable()
class Server {
  constructor(@Inject(APP_CONFIG) private config: AppConfig) {}
}
```

`@Inject(token)` overrides whatever the reflected type would have been for that parameter — it's not limited to `InjectionToken`s; you can use it to point a parameter at a different class than its own type too (useful for interface-like abstract classes, see [Provider kinds](#provider-kinds) below).

Tokens can also be an `abstract class` used purely as an identity:

```ts
abstract class Logger {
  abstract log(message: string): void;
}

@Injectable()
class ConsoleLogger extends Logger {
  log(message: string) {
    console.log(message);
  }
}

container.register({ provide: Logger, useClass: ConsoleLogger });
```

Anything injecting `Logger` gets a `ConsoleLogger`, but only ever refers to the abstract type.

## Provider kinds

`register()` accepts five shapes:

```ts
// A bare class — shorthand for { provide: X, useClass: X }
container.register(UserRepository);

// Bind a token to a different implementation class
container.register({ provide: Logger, useClass: ConsoleLogger });

// A plain value, computed once
container.register({ provide: APP_CONFIG, useValue: { port: 3000 } });

// Computed from other providers, sync or async
container.register({
  provide: APP_CONFIG,
  useFactory: (env: EnvService) => ({ port: env.get("PORT") }),
  inject: [EnvService],
});

// An alias: resolving ALIAS returns the exact same instance as ConcreteLogger
container.register({ provide: ALIAS, useExisting: ConcreteLogger });
```

`useFactory` functions may be `async`; `container.resolve()` awaits them. `useValue` and `useExisting` providers are always effectively singletons (there's no per-call construction to scope).

## `@Optional()`

Marks a constructor parameter as allowed to resolve to `undefined` when nothing is registered for it, instead of throwing `MissingProviderError`:

```ts
@Injectable()
class Service {
  constructor(@Optional() private cache?: CacheService) {}
}
```

This only suppresses a *missing provider*. If the type genuinely can't be reflected (`UnresolvableParameterError`) or the dependency graph is circular (`CircularDependencyError`), `@Optional()` doesn't swallow that — those are programmer/tooling errors, not "this dependency legitimately isn't configured."

## `forwardRef()` for circular references

Two classes that depend on each other by *type* can't both be declared normally in the same module — whichever is declared second doesn't exist yet when the first one's decorator runs, and TypeScript's `design:paramtypes` emission touches the referenced class eagerly (not lazily), so you'd hit a `ReferenceError` before the container ever gets involved.

`forwardRef` defers the reference:

```ts
@Injectable()
class A {
  constructor(@Inject(forwardRef(() => B)) public b: unknown) {}
}

@Injectable()
class B {
  constructor(public a: A) {}
}
```

Note the parameter is typed `unknown`, not `B` — that's required, not stylistic. Typing it `B` would make TypeScript try to reference `B` directly in the emitted metadata array, throwing the same `ReferenceError` `forwardRef` exists to avoid. The `@Inject(forwardRef(...))` override is what actually resolves `B` later, once both classes exist.

A genuine cycle in the dependency graph itself (not just declaration order) still throws `CircularDependencyError`, naming the full cycle: `A -> B -> A`.

## Singletons are memoized against concurrent resolution

If two branches of the same resolve call need the same singleton dependency — a diamond, like two services that both depend on the same `Database` — the container guarantees exactly one instance is built, never a race-created duplicate, even though both branches resolve concurrently. This is handled internally with an in-flight-promise cache; you don't need to do anything to get it.

## Next

- How `@Injectable`/`@Inject` actually store and read their metadata: [Decorators & Metadata](/concepts/decorators-and-metadata/).
- Grouping providers into modules and wiring up a whole app: [Modules](/concepts/modules/).
- Every exported symbol with full signatures: [`@blixis-io/di` reference](/reference/blixis-di/).
