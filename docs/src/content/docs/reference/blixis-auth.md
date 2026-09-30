---
title: "@blixis/auth"
description: Full API reference for the auth package.
sidebar:
  order: 8
---

JWT verification and role-based access control, wired up the same `forRoot()` way as every other `DynamicModule` in this framework. See [Authentication](/concepts/authentication/) for the concepts.

## `defineAuthModule`

```ts
function defineAuthModule<Schema extends ZodType>(
  claimsSchema: Schema,
): {
  AuthModule: { forRoot(options: AuthModuleOptions): DynamicModule };
  JwtAuthGuard: Class<CanActivate>;
  createRolesGuard: (...roles: readonly string[]) => Class<CanActivate>;
  getCurrentUser: (ctx: RequestContext) => z.infer<Schema> | undefined;
};
```

Claims shape is inherently app-specific — unlike `@blixis/logging`'s single fixed `LOGGER` token, there's no one type to validate against. Each call to `defineAuthModule(claimsSchema)` returns its own `JwtAuthGuard` bound to that schema, a `createRolesGuard` that reads users the same guard verified, and `getCurrentUser` for reading them yourself. Call it once per app (typically in its own `auth.ts`), export the result, and use it everywhere:

```ts
// auth.ts
import { defineAuthModule } from "@blixis/auth";
import { z } from "zod";

const ClaimsSchema = z.object({ sub: z.string(), roles: z.array(z.string()) });

export const { AuthModule, JwtAuthGuard, createRolesGuard, getCurrentUser } = defineAuthModule(ClaimsSchema);
```

## `AuthModuleOptions`

```ts
interface AuthModuleOptions {
  secret: string;
  algorithm?: "HS256" | "HS384" | "HS512"; // default "HS256"
  global?: boolean; // default false
}
```

`secret` is the HMAC key used to verify a token's signature (symmetric algorithms only — `HS256`/`HS384`/`HS512`). `global` makes `JwtAuthGuard` visible to every module without each one importing `AuthModule` directly, same escape hatch as `LoggerModule`/`ConfigModule`; defaults to `false`.

## `AuthModule.forRoot(options)`

```ts
@Module({ imports: [AuthModule.forRoot({ secret: process.env.JWT_SECRET! })] })
class PostsModule {}
```

Registers `JwtAuthGuard`, configured with `options`.

## `JwtAuthGuard`

```ts
@UseGuards(JwtAuthGuard)
@Get("me")
me() { /* ... */ }
```

A `CanActivate` guard. Reads the `Authorization` header (must be `Bearer <token>`), verifies the token's signature against `secret`, and validates the decoded payload against `claimsSchema`. Throws `UnauthorizedException` — a `401` — for any failure: missing/malformed header, invalid or expired token, or a payload that fails schema validation. On success, stores the parsed claims in `RequestContext` and returns `true`.

## `createRolesGuard(...roles)`

```ts
function createRolesGuard(...roles: readonly string[]): Class<CanActivate>;
```

Returns a new `CanActivate` guard class requiring the current user to have at least one of `roles`. Assign it to a named export and register it as a provider, like any other guard:

```ts
export const AdminGuard = createRolesGuard("admin");
```

```ts
@Module({ providers: [AdminGuard], /* ... */ })
class PostsModule {}
```

```ts
@UseGuards(JwtAuthGuard, AdminGuard)
@Delete(":id")
remove() { /* ... */ }
```

Must run after `JwtAuthGuard` in the same `@UseGuards(...)` list. Throws `UnauthorizedException` if no user is in `RequestContext` yet (guards misordered, or `JwtAuthGuard` missing) — a plain `false` (→ `403`) only for an authenticated user who genuinely lacks the role.

## `getCurrentUser(ctx)`

```ts
function getCurrentUser(ctx: RequestContext): z.infer<Schema> | undefined;
```

Reads the claims `JwtAuthGuard` verified for the current request out of `RequestContext`. `undefined` outside a request, or before `JwtAuthGuard` has run:

```ts
@Injectable()
class PostsService {
  constructor(private readonly ctx: RequestContext) {}

  create(input: CreatePostInput) {
    const user = getCurrentUser(this.ctx);
    // ...
  }
}
```
