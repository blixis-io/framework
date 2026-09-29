---
title: "@blixis/testing"
description: Full API reference for the testing package.
sidebar:
  order: 4
---

Build a real application in a test, optionally with fakes swapped in, and hit it with real requests. See [Testing](/concepts/testing/) for the concepts.

## `Test.createModule(metadata).compile(options?)`

```ts
const Test: {
  createModule(metadata?: ModuleMetadata): TestModuleBuilder;
};

class TestModuleBuilder {
  override<T>(token: Token<T>, definition: OverrideDefinition<T>): this;
  compile(options?: Omit<HttpApplicationOptions, "overrides">): Promise<TestApplication>;
}

type OverrideDefinition<T> =
  | Omit<ClassProvider<T>, "provide">
  | Omit<ValueProvider<T>, "provide">
  | Omit<FactoryProvider<T>, "provide">
  | Omit<ExistingProvider<T>, "provide">;
```

`createModule(metadata)` takes the same shape as `@Module({...})` (`imports`/`providers`/`controllers` — see [`@blixis/core` reference](/reference/blixis-core/#module)) and wraps it in a synthetic root module internally. `.override(token, definition)` is chainable and queues a provider replacement, applied before the module graph resolves — `definition` is any provider shape minus `provide` (see [`@blixis/di` reference](/reference/blixis-di/#provider-shapes)). `.compile(options?)` builds the real `HttpApplication` (accepting the same `bodyLimit` option as `createHttpApplication` — see [`@blixis/http` reference](/reference/blixis-http/#application) — but not `overrides`, since that's what `.override()` is for) and returns a `TestApplication`.

## `TestApplication`

```ts
class TestApplication {
  constructor(app: HttpApplication);
  request(path: string, init?: TestRequestInit): Promise<Response>;
  get<T>(token: Token<T>): T;
  close(signal?: string): Promise<void>;
}

interface TestRequestInit extends Omit<RequestInit, "body"> {
  body?: RequestInit["body"];
  json?: unknown; // JSON-stringified into the body, sets content-type: application/json automatically
}
```

Thin sugar over a real `HttpApplication` (see [`@blixis/http` reference](/reference/blixis-http/#application)) — `request()` resolves `path` against `http://localhost` and builds the `Request` for you, so `app.request("/posts")` works without constructing a `URL` by hand. `get()` and `close()` pass straight through to the underlying `HttpApplication`.

`TestApplication`'s constructor is public — you can wrap an `HttpApplication` you built another way (say, one from `createHttpApplication` directly) to get the `request()` helper without going through `Test.createModule()` at all.
