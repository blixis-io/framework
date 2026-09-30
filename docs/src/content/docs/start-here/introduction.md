---
title: Introduction
description: What Blixis Framework is, why it exists, and what it's for.
sidebar:
  order: 1
---

Blixis is a TypeScript framework for building API-first backends: a dependency injection container, a decorator-based HTTP layer, and a module system, built from scratch rather than assembled from an existing framework.

It's made of thirteen independent packages:

- **`@blixis-io/di`** — the dependency injection container. `@Injectable`, `@Inject`, tokens, providers, singleton/transient scopes.
- **`@blixis-io/core`** — the module system built on top of `@blixis-io/di`. `@Module`, lifecycle hooks, application bootstrapping.
- **`@blixis-io/http`** — the HTTP layer built on top of `@blixis-io/core`. Routing, controllers, request validation with [Zod](https://zod.dev), guards, RFC 9457 error responses.
- **`@blixis-io/logging`** — a multi-transport logger built on top of `@blixis-io/core`, injectable the same way any other provider is. Doesn't depend on `@blixis-io/http` — usable in any app, HTTP or not.
- **`@blixis-io/config`** — Zod-validated environment config, also built on `@blixis-io/core`, also HTTP-independent.
- **`@blixis-io/db`** — [Drizzle](https://orm.drizzle.team)-backed Postgres persistence, also built on `@blixis-io/core`, also HTTP-independent. Connects and disconnects via the same lifecycle hooks as everything else.
- **`@blixis-io/auth`** — JWT verification and role checks, built on `@blixis-io/http`'s guard primitive, plus optional password sign-in and refresh-token rotation (`Argon2id` hashing, storage-agnostic `CredentialStore`/`RefreshTokenStore` interfaces). App-layer, not a framework dependency — `@blixis-io/http` has no idea it exists.
- **`@blixis-io/method-hooks`** — `@Before`/`@After`/`@Around` method decorators for adding behavior without editing a method's body. No dependency on any other `@blixis-io/*` package — works on any class.
- **`@blixis-io/openapi`** — generates an OpenAPI 3.1 document from a running app's real controllers. Built on `@blixis-io/http`'s decorator metadata; no serving mechanism or bundled UI of its own.
- **`@blixis-io/cli`** — the `blix` binary. `blix generate <type> <name>` scaffolds one controller/service/module/guard/interceptor file from a template. No `@blixis-io/*` dependency at all — a dev-time text-template tool, not a runtime library.
- **`@blixis-io/tenancy`** — request-scoped multi-tenant access control (`TenantScopedGuard`, a fail-closed `tenantScope()` query helper). Owns the mechanism only — no Organization/Space/Membership data model — so it's reusable by any multi-tenant app, not just a CMS.
- **`@blixis-io/events`** — an in-process domain event bus (`defineEventsModule`, `EventBus.emit`/`on`). Depends only on `@blixis-io/core`, like `@blixis-io/logging`/`@blixis-io/config`/`@blixis-io/db` — usable in any app, HTTP or not.
- **`@blixis-io/testing`** — a thin testing layer on top of `@blixis-io/http`. Build a real application in a test, override providers with fakes, hit it with real requests.

Dependencies only point down: `di` depends on nothing; `core` depends on `di`; `http`, `logging`, `config`, `db`, and `events` all depend on `core` (and, transitively, `di`) but not on each other; `auth`, `openapi`, and `tenancy` all depend on `http`; `method-hooks` and `cli` both depend on nothing; `testing` depends on `http`. You can use `@blixis-io/di` — or `@blixis-io/di` + `@blixis-io/core` + `@blixis-io/logging`/`@blixis-io/config`/`@blixis-io/db`/`@blixis-io/events` — on their own without any of the HTTP machinery.

## Why build this instead of using an existing framework

If you've used [NestJS](https://nestjs.com), a lot of this will feel familiar — `@Module`, `@Injectable`, `@Controller`, constructor injection. That's deliberate: constructor injection via decorators is a good pattern. What's different here is everything under it: the container is a few hundred lines you can actually read start to finish, the HTTP layer is built on the Web-standard `Request`/`Response` instead of wrapping a specific server library, and every error the container can throw is a typed class with a message that tells you exactly what to do about it.

The framework prioritizes:

- **Small, readable internals.** No feature exists that you couldn't explain by pointing at the source.
- **Errors that tell you the fix.** `UnresolvableParameterError` doesn't just say "can't resolve" — it says *why* (the reflected type is `Object`, usually from an interface or a circular import) and what to do (`@Inject` a token, or import the class as a value).
- **Standard, not framework-specific, primitives.** Controllers return plain values or a Web-standard `Response`. Guards receive a Web-standard `Request`.

## Why legacy decorators, not the new JavaScript decorators

If you've read about the newer [TC39 decorators proposal](https://github.com/tc39/proposal-decorators) landing in TypeScript, you might expect Blixis to use it. It doesn't — and the reason is a hard constraint, not a preference. See [Why Legacy Decorators](/framework/architecture/why-legacy-decorators/) for the full explanation; the short version is that the new decorator standard dropped *parameter* decorators, and constructor-parameter injection (`constructor(private svc: Service) {}`) is the whole point of this style of DI.

## Where to go next

- New to the framework? Start with the [Quickstart](/framework/start-here/quickstart/) — a running API in under five minutes.
- Want to learn by building something real? Go to [Build Your First API](/framework/tutorials/build-your-first-api/).
- Already comfortable and looking something up? Jump straight to the [API Reference](/framework/reference/blixis-di/).
