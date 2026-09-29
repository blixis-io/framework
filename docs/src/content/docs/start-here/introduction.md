---
title: Introduction
description: What Blixis Framework is, why it exists, and what it's for.
sidebar:
  order: 1
---

Blixis is a TypeScript framework for building API-first backends: a dependency injection container, a decorator-based HTTP layer, and a module system, built from scratch rather than assembled from an existing framework.

It's made of four independent packages:

- **`@blixis/di`** — the dependency injection container. `@Injectable`, `@Inject`, tokens, providers, singleton/transient scopes.
- **`@blixis/core`** — the module system built on top of `@blixis/di`. `@Module`, lifecycle hooks, application bootstrapping.
- **`@blixis/http`** — the HTTP layer built on top of `@blixis/core`. Routing, controllers, request validation with [Zod](https://zod.dev), guards, RFC 9457 error responses.
- **`@blixis/testing`** — a thin testing layer on top of `@blixis/http`. Build a real application in a test, override providers with fakes, hit it with real requests.

Each package only depends on the one below it — `http` depends on `core` and `di`, `core` depends on `di`, `di` depends on nothing. You can use `@blixis/di` on its own without any of the HTTP machinery.

## Why build this instead of using an existing framework

If you've used [NestJS](https://nestjs.com), a lot of this will feel familiar — `@Module`, `@Injectable`, `@Controller`, constructor injection. That's deliberate: constructor injection via decorators is a good pattern. What's different here is everything under it: the container is a few hundred lines you can actually read start to finish, the HTTP layer is built on the Web-standard `Request`/`Response` instead of wrapping a specific server library, and every error the container can throw is a typed class with a message that tells you exactly what to do about it.

The framework prioritizes:

- **Small, readable internals.** No feature exists that you couldn't explain by pointing at the source.
- **Errors that tell you the fix.** `UnresolvableParameterError` doesn't just say "can't resolve" — it says *why* (the reflected type is `Object`, usually from an interface or a circular import) and what to do (`@Inject` a token, or import the class as a value).
- **Standard, not framework-specific, primitives.** Controllers return plain values or a Web-standard `Response`. Guards receive a Web-standard `Request`.

## Why legacy decorators, not the new JavaScript decorators

If you've read about the newer [TC39 decorators proposal](https://github.com/tc39/proposal-decorators) landing in TypeScript, you might expect Blixis to use it. It doesn't — and the reason is a hard constraint, not a preference. See [Why Legacy Decorators](/architecture/why-legacy-decorators/) for the full explanation; the short version is that the new decorator standard dropped *parameter* decorators, and constructor-parameter injection (`constructor(private svc: Service) {}`) is the whole point of this style of DI.

## Where to go next

- New to the framework? Start with the [Quickstart](/start-here/quickstart/) — a running API in under five minutes.
- Want to learn by building something real? Go to [Build Your First API](/tutorials/build-your-first-api/).
- Already comfortable and looking something up? Jump straight to the [API Reference](/reference/blixis-di/).
