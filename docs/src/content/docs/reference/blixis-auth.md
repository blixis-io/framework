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
  AuthModule: { forRoot(options: AuthModuleOptions<z.infer<Schema>>): DynamicModule };
  JwtAuthGuard: Class<CanActivate>;
  createRolesGuard: (...roles: readonly string[]) => Class<CanActivate>;
  getCurrentUser: (ctx: RequestContext) => z.infer<Schema> | undefined;
  /** Resolvable only when `forRoot({ issuing })` was set — otherwise `MissingProviderError` at boot. */
  AUTH_SERVICE: InjectionToken<AuthService>;
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
interface AuthModuleOptions<Claims = unknown> {
  secret: string;
  algorithm?: "HS256" | "HS384" | "HS512"; // default "HS256"
  global?: boolean; // default false
  issuing?: IssuingOptions<Claims>; // omit for verify-only
}
```

`secret` is the HMAC key used to both verify and (if `issuing` is set) sign tokens (symmetric algorithms only — `HS256`/`HS384`/`HS512`). `global` makes `JwtAuthGuard` (and `AUTH_SERVICE`, if configured) visible to every module without each one importing `AuthModule` directly, same escape hatch as `LoggerModule`/`ConfigModule`; defaults to `false`.

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

## Issuing tokens

See [Authentication § Issuing tokens](/concepts/authentication/#issuing-tokens) for the concepts, the fail-closed rules, and what's deliberately deferred (most importantly: **sign-in is unthrottled** — rate limiting is not built in).

### `IssuingOptions<Claims>`

```ts
interface IssuingOptions<Claims> {
  imports?: ModuleRef[]; // so credentialStore/refreshTokenStore can see their own dependencies
  credentialStore: Class<CredentialStore<Claims>>;
  refreshTokenStore: Class<RefreshTokenStore>;
  accessTokenTtl?: number; // seconds, default 900 (15 minutes)
  refreshTokenTtl?: number; // seconds, default 2,592,000 (30 days)
}
```

Both stores are ordinary DI classes (not plain functions, unlike `@blixis/tenancy`'s `resolveMembership`) — a real implementation typically needs to inject `DATABASE` or similar, which a plain function can't do. Without listing the module that exports their dependencies in `imports`, module encapsulation throws `ProviderNotVisibleError` (or `MissingProviderError`, if that module isn't part of the graph at all) when the app boots.

### `CredentialStore<Claims>`

```ts
interface CredentialStore<Claims> {
  findByIdentifier(identifier: string): Promise<{ subject: string; passwordHash: string } | null | undefined>;
  loadClaims(subject: string): Promise<Claims | null | undefined>;
}
```

`findByIdentifier` looks up an account by whatever your app signs in with (email, username, ...) — `null`/`undefined` for no such account. `loadClaims` returns the full claims to sign into the access token for `subject`; it must satisfy your `claimsSchema`, and `null`/`undefined` means the account can't sign in right now (gone or disabled), which fails exactly like a wrong password.

### `RefreshTokenStore`

```ts
interface RefreshTokenRecord {
  subject: string;
  expiresAt: Date;
  rotatedAt?: Date | null;
  revokedAt?: Date | null;
}

interface RefreshTokenStore {
  create(tokenHash: string, record: { subject: string; expiresAt: Date }): Promise<void>;
  find(tokenHash: string): Promise<RefreshTokenRecord | null | undefined>;
  markRotated(tokenHash: string): Promise<boolean>;
  revoke(tokenHash: string): Promise<void>;
  revokeAllForSubject(subject: string): Promise<void>;
}
```

`AuthService` only ever passes a SHA-256 hash of the refresh token, never the raw token — your store never needs to hash anything itself. `markRotated` must be an atomic compare-and-set: mark an active (not already rotated or revoked) token as rotated and resolve `true`, or resolve `false` without changing anything if it was already rotated or revoked — this is the signal `AuthService.refresh()` uses to detect reuse (including two concurrent refreshes of the same token racing each other). `revoke` must be safe to call on an unknown or already-revoked hash — `signOut()` relies on it being a no-op, not a throw.

### `TokenPair`

```ts
interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}
```

### `AuthService`

```ts
interface AuthService {
  signIn(identifier: string, password: string): Promise<TokenPair>;
  refresh(refreshToken: string): Promise<TokenPair>;
  signOut(refreshToken: string): Promise<void>;
  issueTokens(subject: string): Promise<TokenPair>;
  revokeAllSessions(subject: string): Promise<void>;
}
```

Resolve via `@Inject(AUTH_SERVICE)`, typed as `AuthService` (it's not generic over `Claims` — every method returns opaque tokens, never a decoded claims value, so there's nothing for a type parameter to carry).

| Method | Behavior |
|---|---|
| `signIn(identifier, password)` | Throws `UnauthorizedException("Invalid credentials")` for an unknown identifier, wrong password, or a disabled account — identical message in all three cases, and an unknown identifier still runs a real password verification (against a cached dummy hash) so timing doesn't leak account existence. |
| `refresh(refreshToken)` | Rotates the token for a new pair. Throws the same `UnauthorizedException` if it's unknown, expired, revoked, or **already rotated** — reuse of an already-rotated token revokes every refresh token for that subject. |
| `signOut(refreshToken)` | Revokes one refresh token. Idempotent. |
| `issueTokens(subject)` | Issues a fresh pair for a subject already authenticated some other way (e.g. right after sign-up). Throws a plain `Error` if `loadClaims(subject)` returns nothing — the caller's responsibility to ensure the account exists first. |
| `revokeAllSessions(subject)` | Revokes every refresh token for `subject` — for a password change or disabling an account. |

A claims value from `loadClaims` that fails your own `claimsSchema` throws a plain `Error` (not `UnauthorizedException`) from whichever method triggered it — a server bug (the guard that later verifies this token would reject it too), not a client error.

## `hashPassword` / `verifyPassword`

```ts
function hashPassword(password: string): Promise<string>;
function verifyPassword(password: string, hash: string): Promise<boolean>;
```

Argon2id via Node's own `crypto.argon2` (`node:crypto`, no external dependency), at OWASP's minimum recommended cost (`m=19456`, `t=2`, `p=1`). `hashPassword` returns a self-describing PHC string (`$argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>`); `verifyPassword` re-derives using the parameters stored *in* the hash, not the package's current constants, so a stored hash keeps verifying correctly even after a future cost bump. Both are standalone exports with no DI involvement — use them directly for sign-up, seeding, and password-change flows. `verifyPassword` throws (doesn't return `false`) on a malformed or unrecognized hash — that's a data bug, not a wrong password.
