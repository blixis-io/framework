---
title: Creating a Controller
description: Add a new controller to an existing module, from an empty class to a working route.
sidebar:
  order: 1
---

This is the shortest path from nothing to a working route. For the concepts behind each step, see [Routing & Controllers](/framework/concepts/routing-controllers/).

## 1. Write the controller

```ts title="src/health/health.controller.ts"
import { Controller, Get } from "@blixis-io/http";

@Controller("health")
export class HealthController {
  @Get()
  check() {
    return { status: "ok" };
  }
}
```

A controller with no constructor dependencies doesn't even need `@Injectable()` — the container only reflects constructor parameters when there are any (see [Dependency Injection](/framework/concepts/dependency-injection/)). Once this controller needs a service, add one:

```ts title="src/health/health.controller.ts"
import { Controller, Get } from "@blixis-io/http";
import { HealthService } from "./health.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check() {
    return this.health.status();
  }
}
```

## 2. Register it on a module

```ts title="src/health/health.module.ts"
import { Module } from "@blixis-io/core";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";

@Module({
  providers: [HealthService],
  controllers: [HealthController],
})
export class HealthModule {}
```

A controller listed in `controllers` but missing `@Controller()` fails fast with `NotAControllerError` when the app builds — you'll know immediately, not at request time.

## 3. Import the module into your app

```ts title="src/app.module.ts"
@Module({
  imports: [HealthModule /* , ...your other modules */],
})
export class AppModule {}
```

## 4. Add more routes

```ts
@Get(":id")
getOne(@Param("id") id: string) { /* ... */ }

@Post()
create(@Body(CreateSchema) input: CreateInput) { /* ... */ }
```

See [Request Validation](/framework/concepts/request-validation/) for `@Body`/`@Query`/`@Param`/`@Headers`, and [Protecting Routes with Guards](/framework/guides/protecting-routes-with-guards/) to add auth.
