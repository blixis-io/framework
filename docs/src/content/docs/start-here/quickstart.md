---
title: Quickstart
description: An empty directory to a running API in under five minutes.
sidebar:
  order: 3
---

This walks through the smallest possible Blixis app: one service, one controller, one module, running on a real socket. It mirrors the shape of the framework's own `examples/hello-api` reference app — see the [hello-api Walkthrough](/framework/examples/hello-api-walkthrough/) for the full CRUD version.

:::tip
`pnpm create blixis my-app` generates exactly this app and installs its dependencies. This page builds it by hand so you can see each piece.
:::

## 1. Create the app

```bash
mkdir hello-quickstart && cd hello-quickstart
pnpm init
pnpm add @blixis-io/core @blixis-io/di @blixis-io/http
pnpm add -D typescript @types/node
mkdir src
```

In `package.json`, add `"type": "module"` and these scripts:

```json title="package.json"
{
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js"
  }
}
```

```json title="tsconfig.json"
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "types": ["node"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

Note there's no `tsx`/`ts-node` step here: Node's own TypeScript support strips *types* but doesn't transform *decorators* (they're runtime JavaScript, not type syntax), so every app in this framework builds with `tsc` first and runs the compiled output. See [Installation](/framework/start-here/installation/) for why the two decorator compiler flags are non-negotiable.

## 2. Write a service

```ts title="src/hello.service.ts"
import { Injectable } from "@blixis-io/di";

@Injectable()
export class HelloService {
  greet(name: string): string {
    return `Hello, ${name}!`;
  }
}
```

`@Injectable()` isn't optional decoration — TypeScript only emits the constructor's parameter types (`design:paramtypes`) for a *decorated* class, so it's what makes this class resolvable at all. See [Dependency Injection](/framework/concepts/dependency-injection/).

## 3. Write a controller

```ts title="src/hello.controller.ts"
import { Controller, Get, Param } from "@blixis-io/http";
import { HelloService } from "./hello.service.js";

@Controller("hello")
export class HelloController {
  constructor(private readonly hello: HelloService) {}

  @Get(":name")
  greet(@Param("name") name: string) {
    return { message: this.hello.greet(name) };
  }
}
```

`this.hello` was never assigned by hand — the container built it from `HelloService`'s own `@Injectable()` registration. See [Routing & Controllers](/framework/concepts/routing-controllers/).

## 4. Wire up the module

```ts title="src/app.module.ts"
import { Module } from "@blixis-io/core";
import { HelloController } from "./hello.controller.js";
import { HelloService } from "./hello.service.js";

@Module({
  providers: [HelloService],
  controllers: [HelloController],
})
export class AppModule {}
```

## 5. Boot it

```ts title="src/main.ts"
import { createHttpApplication } from "@blixis-io/http";
import { AppModule } from "./app.module.js";

const app = await createHttpApplication(AppModule);
await app.listen(3000);

console.log("Listening on http://localhost:3000");
```

```bash
pnpm run build && pnpm start
```

## 6. Try it

```bash
curl http://localhost:3000/hello/world
```

```json
{ "message": "Hello, world!" }
```

## What just happened

- `createHttpApplication(AppModule)` walked the module graph, registered `HelloService` and `HelloController` in a `Container`, resolved everything, and ran any `OnModuleInit` hooks (none here).
- `app.listen(3000)` bound a real `node:http` server and translated every incoming request into a Web-standard `Request`, then translated the returned `Response` back onto the socket.
- `@Get(":name")` on `HelloController` combined with the controller's `"hello"` prefix to register `GET /hello/:name` on the internal router; `@Param("name")` pulled the `:name` segment out of the matched route and handed it to `greet()` as a plain string.

## Next steps

- Add request validation, a second route, and a guard: [Build Your First API](/framework/tutorials/build-your-first-api/).
- Understand what `Injectable`/`Inject`/tokens actually do under the hood: [Dependency Injection](/framework/concepts/dependency-injection/).
- See the full CRUD version of this same shape: the [hello-api Walkthrough](/framework/examples/hello-api-walkthrough/).
