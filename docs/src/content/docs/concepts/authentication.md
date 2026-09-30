---
title: Authentication
description: JWT verification and role-based access control via JwtAuthGuard and createRolesGuard.
sidebar:
  order: 14
---

`@blixis/auth` verifies bearer JWTs and checks roles, built entirely on primitives [Guards & Authorization](/concepts/guards-and-authorization/) and [Request Context](/concepts/request-context/) already introduced — it's app-layer, not a framework dependency: `@blixis/http` has no idea `@blixis/auth` exists.

This is **verification only**. Issuing tokens — login, registration, password hashing — is left to your app; `@blixis/auth` starts from "here's a bearer token," not "here's a password."

## Why it's a factory, not a fixed token

Like `@blixis/config`, every app's JWT payload shape is different — there's no single fixed type to validate against. So `@blixis/auth` exports a **function**, `defineAuthModule`, that builds a guard bound to your own Zod schema:

```ts
// auth.ts
import { defineAuthModule } from "@blixis/auth";
import { z } from "zod";

const ClaimsSchema = z.object({
  sub: z.string(),
  roles: z.array(z.string()),
});

export const { AuthModule, JwtAuthGuard, createRolesGuard, getCurrentUser } = defineAuthModule(ClaimsSchema);
```

## Verifying a token

```ts
@Module({ imports: [AuthModule.forRoot({ secret: process.env.JWT_SECRET! })] })
class PostsModule {}
```

```ts
@UseGuards(JwtAuthGuard)
@Get("me")
me() {
  // ...
}
```

`JwtAuthGuard` reads the `Authorization` header, verifies the token (HMAC — `HS256` by default, or `HS384`/`HS512`) against the `secret` from `forRoot()`, and validates the decoded payload against your claims schema. Any failure — missing header, bad signature, expired token, a payload that fails the schema — throws `UnauthorizedException` (a real `401`), never a plain `false`: a bad token is a client authentication failure, not a generic "denied," so it gets its own status rather than folding into a guard's usual `403`.

On success, the verified claims are stored in [`RequestContext`](/concepts/request-context/) for the rest of the request. Read them back with `getCurrentUser`:

```ts
@Injectable()
class PostsService {
  constructor(private readonly ctx: RequestContext) {}

  create(input: CreatePostInput) {
    const user = getCurrentUser(this.ctx); // { sub: string; roles: string[] } | undefined
    // ...
  }
}
```

`getCurrentUser` returns `undefined` outside a request, or inside one where `JwtAuthGuard` hasn't run (or wasn't applied to this route) — same honest-`undefined` philosophy as `RequestContext.get()` itself.

## Role checks with `createRolesGuard`

Role-based access is a **second guard**, not a decorator — consistent with this framework's guard-is-the-authorization-primitive philosophy (see [Guards & Authorization](/concepts/guards-and-authorization/)) rather than introducing a parallel `@Roles()` metadata system:

```ts
export const AdminGuard = createRolesGuard("admin");
```

```ts
@Module({
  imports: [AuthModule.forRoot({ secret: process.env.JWT_SECRET! })],
  providers: [AdminGuard],
})
class PostsModule {}
```

```ts
@UseGuards(JwtAuthGuard, AdminGuard)
@Delete(":id")
remove(@Param("id") id: string) {
  // ...
}
```

`createRolesGuard(...roles)` returns a **fresh class each call** — same shape as `defineConfigModule` returning an app-specific class from a closure. Assign it to a named export and list it in `providers`, exactly like any other guard — leaving a guard class out of `providers` is the single most common mistake with `@UseGuards`, see [Guards & Authorization](/concepts/guards-and-authorization/#guard-classes-must-be-registered-providers).

`AdminGuard` must run **after** `JwtAuthGuard` in the same `@UseGuards(...)` list: guards run sequentially and short-circuit, so by the time `AdminGuard` checks `getCurrentUser(ctx).roles`, `JwtAuthGuard` has already populated it. If no user is in `RequestContext` yet — guards misordered, or `JwtAuthGuard` left off entirely — `AdminGuard` throws `UnauthorizedException` rather than silently returning `false`, since "no identity at all" and "identity, but wrong role" are different failures worth telling apart.

A user with none of the required roles gets a plain `false` — same as any other guard denial — which the framework turns into `403 Forbidden`.

## `global` is off by default

```ts
AuthModule.forRoot({ secret, global: true })
```

Same default as `@blixis/db`'s `DrizzleModule`, for the same reason: most apps only need `JwtAuthGuard` in the modules that actually have protected routes, so encapsulation is the better default. Pass `global: true` if most of your app sits behind auth.

## Next

- Every exported symbol: [`@blixis/auth` reference](/reference/blixis-auth/).
- The guard primitive this is built on: [Guards & Authorization](/concepts/guards-and-authorization/).
- Where verified claims live between guards, interceptors, and the handler: [Request Context](/concepts/request-context/).
