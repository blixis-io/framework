# Blixis Framework

[![CI](https://github.com/blixis-io/framework/actions/workflows/ci.yml/badge.svg)](https://github.com/blixis-io/framework/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/blixis-io/framework/graph/badge.svg)](https://codecov.io/gh/blixis-io/framework)
[![npm](https://img.shields.io/npm/v/@blixis-io/core.svg)](https://www.npmjs.com/package/@blixis-io/core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Dependency injection, decorators, and an HTTP layer you actually understand — built from scratch, not bolted onto one.

Blixis is a TypeScript framework for building API-first backends: a dependency injection container, a decorator-based HTTP layer, and a module system, built from scratch rather than assembled from an existing framework. If you've used [NestJS](https://nestjs.com), a lot of this will feel familiar — `@Module`, `@Injectable`, `@Controller`, constructor injection. What's different is everything under it: the container is a few hundred lines you can actually read start to finish, the HTTP layer is built on the Web-standard `Request`/`Response` instead of wrapping a specific server library, and every error the container can throw is a typed class with a message that tells you exactly what to do about it.

## Get started

Scaffold a runnable app:

```bash
pnpm create blixis my-app
```

Or add the packages to an existing project:

```bash
npm install @blixis-io/di @blixis-io/core @blixis-io/http
```

```ts
// hello.controller.ts
import { Controller, Get, Param } from "@blixis-io/http";
import { Injectable } from "@blixis-io/di";

@Injectable()
class HelloService {
  greet(name: string) {
    return { message: `Hello, ${name}!` };
  }
}

@Controller("hello")
class HelloController {
  constructor(private readonly hello: HelloService) {}

  @Get(":name")
  greet(@Param("name") name: string) {
    return this.hello.greet(name);
  }
}
```

```ts
// main.ts
import { createHttpApplication } from "@blixis-io/http";
import { Module } from "@blixis-io/core";
import { HelloController, HelloService } from "./hello.controller.js";

@Module({ providers: [HelloService], controllers: [HelloController] })
class AppModule {}

const app = await createHttpApplication(AppModule);
await app.listen(3000);
```

```bash
curl localhost:3000/hello/world
# {"message":"Hello, world!"}
```

Legacy decorators are required (`experimentalDecorators` + `emitDecoratorMetadata`) — see the [installation guide](https://blixis-io.github.io/framework/start-here/installation/) for the exact `tsconfig.json` this needs and why. Full walkthrough: [Quickstart](https://blixis-io.github.io/framework/start-here/quickstart/).

## Packages

| Package | Description |
|---|---|
| [`@blixis-io/di`](packages/di) | The dependency injection container. `@Injectable`, `@Inject`, tokens, providers, singleton/transient scopes. |
| [`@blixis-io/core`](packages/core) | The module system built on `@blixis-io/di`. `@Module`, lifecycle hooks, application bootstrapping. |
| [`@blixis-io/http`](packages/http) | The HTTP layer built on `@blixis-io/core`. Routing, controllers, request validation with Zod, guards, RFC 9457 error responses. |
| [`@blixis-io/logging`](packages/logging) | A multi-transport logger, injectable like any other provider. HTTP-independent. |
| [`@blixis-io/config`](packages/config) | Zod-validated environment config, also HTTP-independent. |
| [`@blixis-io/db`](packages/db) | [Drizzle](https://orm.drizzle.team)-backed Postgres persistence, connected/disconnected via lifecycle hooks. |
| [`@blixis-io/auth`](packages/auth) | JWT verification and role checks, plus optional password sign-in and refresh-token rotation. |
| [`@blixis-io/method-hooks`](packages/method-hooks) | `@Before`/`@After`/`@Around` method decorators for adding behavior without editing a method's body. |
| [`@blixis-io/openapi`](packages/openapi) | Generates an OpenAPI 3.1 document from a running app's real controllers. |
| [`@blixis-io/cli`](packages/cli) | The `blix` binary — scaffolds controller/service/module/guard/interceptor files from a template. |
| [`@blixis-io/commands`](packages/commands) | `@Command` — command-line tasks as injectable classes, run with `blix run`. |
| [`@blixis-io/deploy`](packages/deploy) | `blix deploy` — build a Docker image, push it, and generate a GitHub Actions workflow. |
| [`create-blixis`](packages/create-blixis) | `pnpm create blixis my-app` — scaffolds a runnable starter app and installs its dependencies. |
| [`@blixis-io/tenancy`](packages/tenancy) | Request-scoped multi-tenant access control — mechanism only, no data model. |
| [`@blixis-io/events`](packages/events) | An in-process domain event bus. |
| [`@blixis-io/testing`](packages/testing) | A thin testing layer on top of `@blixis-io/http` — real requests, fakeable providers. |

## Docs

Full documentation, concepts, guides, and tutorials: **[blixis-io.github.io/framework](https://blixis-io.github.io/framework/)**.

## License

[MIT](LICENSE) © [Michael Voeten](mailto:michael@voeten.online)
