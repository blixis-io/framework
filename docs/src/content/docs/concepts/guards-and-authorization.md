---
title: Guards & Authorization
description: "@UseGuards, CanActivate, and how guard denial short-circuits a request."
sidebar:
  order: 7
---

A guard decides, before a controller method ever runs, whether a request is allowed through. Guards are DI-resolved classes — not plain functions — so they can depend on services the same way any other provider does.

## `CanActivate`

```ts
import type { CanActivate, ExecutionContext } from "@blixis/http";
import { Injectable } from "@blixis/di";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return context.request.headers.get("x-api-key") === "dev-secret";
  }
}
```

`ExecutionContext` is `{ request: Request, params: Record<string, string> }` — the same matched route params the controller method itself receives via `@Param`. `canActivate` can be sync or async, and can return `false` to deny or throw its own `HttpException` (an `UnauthorizedException`, say) for a more specific status than the default.

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

- A full worked guard, wired into a module and tested both ways: [Protecting Routes with Guards](/guides/protecting-routes-with-guards/).
- The full tutorial: [Add Authentication](/tutorials/add-authentication/).
- How a guard's `false`/thrown error becomes a response: [Error Handling](/concepts/error-handling/).
