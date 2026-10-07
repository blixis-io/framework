---
title: Guards & Authorization
description: "@UseGuards, CanActivate, and how guard denial short-circuits a request."
sidebar:
  order: 7
---

A guard decides, before a controller method ever runs, whether a request is allowed through. Guards are DI-resolved classes — not plain functions — so they can depend on services the same way any other provider does.

## `CanActivate`

```ts
import type { CanActivate, ExecutionContext } from "@blixis-io/http";
import { Injectable } from "@blixis-io/di";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return context.request.headers.get("x-api-key") === "dev-secret";
  }
}
```

This one compares a single hard-coded string, which is enough to show the shape of a guard and **nothing more**: no per-client identity, expiry or revocation, and `===` is not a constant-time comparison. For real API keys use [`@blixis-io/auth`'s](/framework/guides/api-keys/).

`ExecutionContext` is `{ request, params, controller, handler }`: the `Request`, the matched route params (the same ones the controller method receives via `@Param`), the controller class, and the name of the method handling the request. The last two are what let a guard read metadata attached to the route (see [Route metadata](#route-metadata)). `canActivate` can be sync or async, and can return `false` to deny or throw its own `HttpException` (an `UnauthorizedException`, say) for a more specific status than the default.

## `@UseGuards`

Apply at the controller level (every route in the controller), the method level (just that route), or both — guards from both positions run, class-level first:

```ts
@UseGuards(AuthGuard)
@Controller("posts")
export class PostController {
  @Get()
  list() { /* AuthGuard only */ }

  @UseGuards(AdminGuard)
  @Delete(":id")
  remove() { /* AuthGuard, then AdminGuard */ }
}
```

Guards run **in order, and stop at the first denial** — a later guard never runs once an earlier one has already said no. If any guard returns `false`, the request short-circuits to `403 Forbidden` before params are resolved or the body is read.

## Global guards

A guard marked with `@GlobalGuard()` runs on **every** route, before the route's own `@UseGuards` (class, then method):

```ts
@Injectable()
@GlobalGuard()
export class RequireHttps implements CanActivate {
  canActivate({ request }: ExecutionContext): boolean {
    return new URL(request.url).protocol === "https:";
  }
}
```

Register it as a provider like any other guard; there is nothing else to wire up. The application finds marked guards among its providers when it starts. Several global guards run in dependency order (a guard that injects another runs after it), and the first to deny stops the request, so neither the route's own guards nor its handler run. A marked class without a `canActivate()` method fails the boot with its name.

## Route metadata

`SetRouteMetadata(key, value)` attaches a value to a controller (every route in it) or to a single route, and `getRouteMetadata(key, context)` reads it back inside a guard or interceptor: the method's own value if it has one, otherwise the controller's. It is how decorators like `@Roles("admin")` and `@Public()` are built:

```ts
const AUDIT = Symbol("audit");
export const Audited = (label: string) => SetRouteMetadata(AUDIT, label);

@Injectable()
@GlobalGuard()
class AuditGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const label = getRouteMetadata(AUDIT, context);
    if (typeof label === "string") console.log(`audited route: ${label}`);
    return true;
  }
}
```

`getRouteMetadata` returns `unknown`; narrow it where you read it. Use your own `Symbol` as the key so two packages' metadata never collide.

## Guard classes must be registered providers

This is the one non-obvious rule: `@UseGuards(AuthGuard)` only records *which class* to ask the DI container for at request time — it doesn't register `AuthGuard` as a provider itself. You still need to list it in the owning module:

```ts
@Module({
  providers: [PostService, AuthGuard],
  controllers: [PostController],
})
class PostsModule {}
```

Forget this and the guard was never resolved during application startup, so asking for it at request time fails — the framework doesn't (yet) auto-register a guard class the way it auto-registers a bare-class provider. This also means a guard's own constructor dependencies work exactly like any other provider's:

```ts
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly users: UserService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const token = context.request.headers.get("authorization");
    return token !== null && (await this.users.verifyToken(token));
  }
}
```

## Next

- A full worked guard, wired into a module and tested both ways: [Protecting Routes with Guards](/framework/guides/protecting-routes-with-guards/).
- API keys, with scopes and revocation, built on a guard like this: [API keys for machines](/framework/guides/api-keys/).
- The full tutorial: [Add Authentication](/framework/tutorials/add-authentication/).
- How a guard's `false`/thrown error becomes a response: [Error Handling](/framework/concepts/error-handling/).
