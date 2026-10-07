---
title: "@blixis-io/auth"
description: Full API reference for the auth package.
sidebar:
  order: 8
---

JWT verification and role-based access control, wired up the same `forRoot()` way as every other `DynamicModule` in this framework. See [Authentication](/framework/concepts/authentication/) for the concepts.

## `defineAuthModule`

```ts
function defineAuthModule<Schema extends ZodType>(
  claimsSchema: Schema,
): {
  AuthModule: { forRoot(options: AuthModuleOptions<z.infer<Schema>>): DynamicModule };
  JwtAuthGuard: Class<CanActivate>;
  AuthGuard: Class<CanActivate>; // authenticates unless @Public(), then enforces @Roles
  createRolesGuard: (...roles: readonly string[]) => Class<CanActivate>;
  getCurrentUser: (ctx: RequestContext) => z.infer<Schema> | undefined;
  /** Resolvable only when `forRoot({ issuing })` was set — otherwise `MissingProviderError` at boot. */
  AUTH_SERVICE: InjectionToken<AuthService>;
};
```

Claims shape is inherently app-specific — unlike `@blixis-io/logging`'s single fixed `LOGGER` token, there's no one type to validate against. Each call to `defineAuthModule(claimsSchema)` returns its own `JwtAuthGuard` bound to that schema, a `createRolesGuard` that reads users the same guard verified, and `getCurrentUser` for reading them yourself. Call it once per app (typically in its own `auth.ts`), export the result, and use it everywhere:

```ts
// auth.ts
import { defineAuthModule } from "@blixis-io/auth";
import { z } from "zod";

const ClaimsSchema = z.object({ sub: z.string(), roles: z.array(z.string()) });

export const { AuthModule, JwtAuthGuard, createRolesGuard, getCurrentUser } = defineAuthModule(ClaimsSchema);
```

## `Roles`, `Public` and `AuthGuard`

```ts
function Roles(...roles: readonly string[]): ClassDecorator & MethodDecorator; // at least one of roles
function Public(): ClassDecorator & MethodDecorator; // skips authentication
```

`AuthGuard` authenticates the request (`401` on a missing, malformed, expired or invalid token, or claims that fail your schema) unless the route is `@Public()`, then, if the route or its controller has `@Roles(...)`, requires one of them in the token's `roles` claim (`403` otherwise). A route's `@Roles`/`@Public` wins over its controller's. Apply it per controller or route with `@UseGuards(AuthGuard)`, or everywhere with `protectAllRoutes` below. `Roles` and `Public` are plain route metadata (`SetRouteMetadata` from `@blixis-io/http`) and do nothing unless `AuthGuard` runs.

## `AuthModuleOptions`

```ts
interface AuthModuleOptions<Claims = unknown> {
  secret: string; // at least 32 bytes (HS256), 48 (HS384) or 64 (HS512), else AuthConfigError
  algorithm?: "HS256" | "HS384" | "HS512"; // default "HS256"
  issuer?: string; // expected `iss`; also signed into issued tokens
  audience?: string | readonly string[]; // expected `aud`; also signed into issued tokens
  global?: boolean;
  protectAllRoutes?: boolean; // default false: every route needs a token unless @Public() // default false
  issuing?: IssuingOptions<Claims>; // omit for verify-only
}
```

`secret` is the HMAC key used to both verify and (if `issuing` is set) sign tokens (symmetric algorithms only — `HS256`/`HS384`/`HS512`). It must be at least as long as the hash output, in bytes: 32, 48 or 64; a shorter one makes `forRoot()` throw `AuthConfigError`. A token must have an `exp` claim, and, when `issuer` or `audience` is set, a matching `iss` or `aud`; the `Authorization` scheme `Bearer` is matched case-insensitively. `global` makes `JwtAuthGuard` (and `AUTH_SERVICE`, if configured) visible to every module without each one importing `AuthModule` directly, same escape hatch as `LoggerModule`/`ConfigModule`; defaults to `false`.

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

See [Authentication § Issuing tokens](/framework/concepts/authentication/#issuing-tokens) for the concepts, the fail-closed rules, and what's deliberately deferred (most importantly: **sign-in is unthrottled** — rate limiting is not built in).

### `IssuingOptions<Claims>`

```ts
interface IssuingOptions<Claims> {
  imports?: ModuleRef[]; // so credentialStore/refreshTokenStore can see their own dependencies
  credentialStore: Class<CredentialStore<Claims>>;
  refreshTokenStore: Class<RefreshTokenStore>;
  accessTokenTtl?: number; // seconds, default 900 (15 minutes)
  refreshTokenTtl?: number; // seconds, default 2,592,000 (30 days)
  refreshReuseGraceSeconds?: number; // default 0 (off); a just-rotated token is refused without revoking anything for this long
}
```

Both stores are ordinary DI classes (not plain functions, unlike `@blixis-io/tenancy`'s `resolveMembership`) — a real implementation typically needs to inject `DATABASE` or similar, which a plain function can't do. Without listing the module that exports their dependencies in `imports`, module encapsulation throws `ProviderNotVisibleError` (or `MissingProviderError`, if that module isn't part of the graph at all) when the app boots.

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
  familyId?: string | null; // the sign-in this token descends from
}

interface NewRefreshToken {
  subject: string;
  expiresAt: Date;
  familyId: string; // store it if you implement revokeFamily; ignoring it is fine
}

interface RefreshTokenStore {
  create(tokenHash: string, record: NewRefreshToken): Promise<void>;
  find(tokenHash: string): Promise<RefreshTokenRecord | null | undefined>;
  markRotated(tokenHash: string): Promise<boolean>;
  revoke(tokenHash: string): Promise<void>;
  revokeAllForSubject(subject: string): Promise<void>;
  // optional:
  rotate?(oldTokenHash: string, next: NewRefreshToken & { tokenHash: string }): Promise<boolean>;
  revokeFamily?(familyId: string): Promise<void>;
}
```

`AuthService` only ever passes a SHA-256 hash of the refresh token, never the raw token — your store never needs to hash anything itself. `markRotated` must be an atomic compare-and-set: mark an active (not already rotated or revoked) token as rotated and resolve `true`, or resolve `false` without changing anything if it was already rotated or revoked — this is the signal `AuthService.refresh()` uses to detect reuse (including two concurrent refreshes of the same token racing each other). `revoke` must be safe to call on an unknown or already-revoked hash — `signOut()` relies on it being a no-op, not a throw.

**Optional, and worth implementing.** `rotate(oldTokenHash, next)` marks the old token rotated and stores the successor in **one atomic step** (a transaction), resolving `false`, having changed nothing, if the old token was already rotated or revoked; when it exists `refresh()` calls it instead of `create` plus `markRotated`. `revokeFamily(familyId)` revokes every token of one sign-in. Neither is required: without `rotate`, `refresh()` stores the successor before marking the old token rotated, so a failure leaves the old token usable. See [Making rotation resilient](/framework/guides/issuing-tokens/#making-rotation-resilient).

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
| `refresh(refreshToken)` | Rotates the token for a new pair. Throws the same `UnauthorizedException` if it's unknown, expired, revoked, or **already rotated** — reuse of an already-rotated token revokes that login (its family when the store implements `revokeFamily`, else every refresh token for the subject), unless it was rotated within `refreshReuseGraceSeconds`, which is a plain refusal. |
| `signOut(refreshToken)` | Revokes one refresh token. Idempotent. |
| `issueTokens(subject)` | Issues a fresh pair for a subject already authenticated some other way (e.g. right after sign-up). Throws a plain `Error` if `loadClaims(subject)` returns nothing — the caller's responsibility to ensure the account exists first. |
| `revokeAllSessions(subject)` | Revokes every refresh token for `subject` — for a password change or disabling an account. |

A claims value from `loadClaims` that fails your own `claimsSchema` throws a plain `Error` (not `UnauthorizedException`) from whichever method triggered it — a server bug (the guard that later verifies this token would reject it too), not a client error.

## API keys

Machine credentials: a key in the `x-api-key` header, checked against **your** store, resolving to the **same claims** as a token, so `@Roles`, `getCurrentUser` and tenancy work unchanged. Enable it with `apiKeys` on `forRoot`:

```ts
AuthModule.forRoot({
  secret,
  protectAllRoutes: true,
  apiKeys: { store: PostgresApiKeyStore, imports: [PoolModule], clientIp: { trustedProxyHops: 1 }, cacheSeconds: 0 },
});
```

### How a request is decided

- **`x-api-key` present means it is the credential.** A bad key is a `401`, never a fall back to the `Authorization` header (that header is not looked at). With `apiKeys` unset the header is ignored and a token is required as before.
- **Every failure is the same `401` with the same words** (`Invalid API key`): malformed, unknown id, wrong secret, revoked, expired, outside `allowedCidrs`, stored claims that fail your schema. A response never says which part was wrong.
- **A store that throws is a `503`**, never an allow. So is a malformed network already sitting in a stored record.
- A key that is not exactly `blx_<24 hex>_<43 base64url>` is refused **before** the store is asked, so junk cannot be used to hammer the database.

### `generateApiKey()`, `parseApiKey(text)`, `hashApiKeySecret(secret)`

`generateApiKey()` returns `{ id, key, secretHash }`: `key` is `blx_<id>_<secret>` (the id 12 random bytes in hex, the secret 32 random bytes in base64url, 256 bits from the system's CSPRNG). **Show `key` once and store only `id` and `secretHash`.** The hash is a plain SHA-256 on purpose: the secret has nothing to guess, and a slow password hash would only cost every request time. The comparison is constant time (`timingSafeEqual`), and an unknown id is compared against a dummy hash so it costs about what a wrong secret costs (by construction: not measured here).

### `ApiKeyStore`

```ts
interface ApiKeyStore {
  find(id: string): Promise<ApiKeyRecord | undefined>; // throwing means "cannot tell": a 503
  touch?(id: string, at: Date): Promise<void>;                 // optional, best effort
}

interface ApiKeyRecord {
  id: string;
  secretHash: string;
  claims: unknown;                      // validated by your claims schema, like a token's payload
  scopes?: readonly string[];           // read back with getCurrentApiKey(ctx)
  expiresAt?: Date | null;              // refused from this moment
  revokedAt?: Date | null;              // refused from this moment; the row stays for audit
  allowedCidrs?: readonly string[] | null; // empty or missing: from anywhere
}
```

A reference Postgres store, with `create`, `revoke` and last-used tracking, is in the repository (`packages/auth/src/postgres-api-key-store.example.ts`, run against a real database by its test). It is not exported: copy it.

### `apiKeys` options

| Option | Meaning |
| --- | --- |
| `store` | Your store, a DI class. |
| `imports` | Modules the store needs to see, as `issuing.imports`. |
| `clientIp` | How the address for `allowedCidrs` is decided: the options of [`getClientIp`](/framework/reference/blixis-security/#getclientip). **Behind a proxy every client looks like the proxy until you set `trustedProxyHops`; set wrongly, or with the server reachable around the proxy, a client chooses its own address.** An unknown address is refused for a key that has `allowedCidrs`. |
| `cacheSeconds` | Seconds a found record is remembered in this process (default `0`, off). **It is also the longest a revocation, expiry change or new network takes to apply** to a process holding the old record. The secret is still compared on every request; only the record is cached. Keys that were not found are never cached. |
| `lastUsedIntervalSeconds` | `touch` at most once per key and process in this many seconds (default 300); a failing `touch` is ignored. |

### `getCurrentApiKey(ctx)`

`{ id, scopes }` of the key that authenticated the request, or `undefined` for a token. Log the **id**, never the key; and make sure your access log does not record the `x-api-key` header.

### `RequireScopes(...scopes)` and `scopedRoutesOnly`

```ts
@Controller("projects")
@RequireScopes("projects:read")          // every route needs it ...
class ProjectsController {
  @Post()
  @RequireScopes("projects:write")       // ... unless the route names its own, which replaces it
  create() {}
}
```

An API key must hold **all** of the listed scopes (its `scopes` in the store), or the request is a **403**. Scopes limit **keys only**: a request authenticated with a token is never held to them, because a person's permissions come from their roles and membership. Like `@Roles`, `@RequireScopes` takes effect where `AuthGuard` runs (everywhere with `protectAllRoutes: true`).

`apiKeys.scopedRoutesOnly: true` makes a key refused (403) on any route **without** `@RequireScopes`, so a key can only reach routes that say what they need. **Turn it on**: without it, a key holding only `read` still reaches every route nobody annotated. Public routes stay public.

**`JwtAuthGuard` accepts tokens only**, on purpose: a key must not get in through a guard that cannot check scopes. Use `AuthGuard` (or `protectAllRoutes`) on routes that should accept keys.

### What this does not do

No 2FA (it does not apply to a machine credential: require it on the human sign-in that creates or rotates a key), no mTLS, request signing or OAuth client credentials, and no rate limit of its own: `rateLimit({ key })` from `@blixis-io/security` runs **before** authentication, so keying it on the key id in the header would let anyone use up another key's allowance by sending its id without the secret. Count per key **after** the guard, as `examples/saas-api`'s `KeyRateLimitGuard` does. Unknown ids are not rate limited by this package: put a limiter in front.

## `hashPassword` / `verifyPassword`

```ts
function hashPassword(password: string): Promise<string>;
function verifyPassword(password: string, hash: string): Promise<boolean>;
```

Argon2id via Node's own `crypto.argon2` (`node:crypto`, no external dependency), at OWASP's minimum recommended cost (`m=19456`, `t=2`, `p=1`). `hashPassword` returns a self-describing PHC string (`$argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>`); `verifyPassword` re-derives using the parameters stored *in* the hash, not the package's current constants, so a stored hash keeps verifying correctly even after a future cost bump. Both are standalone exports with no DI involvement — use them directly for sign-up, seeding, and password-change flows. `verifyPassword` throws (doesn't return `false`) on a malformed or unrecognized hash — that's a data bug, not a wrong password.
