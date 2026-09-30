---
title: Authentication
description: JWT verification and role-based access control via JwtAuthGuard and createRolesGuard.
sidebar:
  order: 14
---

`@blixis-io/auth` verifies bearer JWTs and checks roles, built entirely on primitives [Guards & Authorization](/concepts/guards-and-authorization/) and [Request Context](/concepts/request-context/) already introduced — it's app-layer, not a framework dependency: `@blixis-io/http` has no idea `@blixis-io/auth` exists.

By default this is **verification only** — `@blixis-io/auth` starts from "here's a bearer token," not "here's a password." Pass `issuing` to `forRoot()` to also get password sign-in, refresh-token rotation, and sign-out — see [Issuing tokens](#issuing-tokens) below.

## Why it's a factory, not a fixed token

Like `@blixis-io/config`, every app's JWT payload shape is different — there's no single fixed type to validate against. So `@blixis-io/auth` exports a **function**, `defineAuthModule`, that builds a guard bound to your own Zod schema:

```ts
// auth.ts
import { defineAuthModule } from "@blixis-io/auth";
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

Same default as `@blixis-io/db`'s `DrizzleModule`, for the same reason: most apps only need `JwtAuthGuard` in the modules that actually have protected routes, so encapsulation is the better default. Pass `global: true` if most of your app sits behind auth.

## Issuing tokens

Pass `issuing` to `forRoot()` to turn on `AUTH_SERVICE` — password sign-in, refresh-token rotation, and sign-out. `@blixis-io/auth` stays **storage-agnostic**: you implement two small interfaces as ordinary DI classes, the package never depends on `@blixis-io/db` or any particular ORM.

```ts
// auth.ts
export const { AuthModule, JwtAuthGuard, createRolesGuard, getCurrentUser, AUTH_SERVICE } =
  defineAuthModule(ClaimsSchema);
```

```ts
@Module({
  imports: [
    AuthModule.forRoot({
      secret: process.env.JWT_SECRET!,
      issuing: {
        imports: [UsersModule], // whatever exports the stores' own dependencies (e.g. DATABASE)
        credentialStore: DrizzleCredentialStore,
        refreshTokenStore: DrizzleRefreshTokenStore,
      },
    }),
  ],
})
class AppModule {}
```

```ts
@Injectable()
class AuthController {
  constructor(@Inject(AUTH_SERVICE) private readonly auth: AuthService) {}

  @Post("sign-in")
  async signIn(@Body(SignInSchema) body: SignInInput) {
    return this.auth.signIn(body.email, body.password);
  }
}
```

See the [Issuing Tokens guide](/guides/issuing-tokens/) for a full working `CredentialStore`/`RefreshTokenStore` pair backed by Drizzle, plus a sign-up flow using `hashPassword`.

### Password hashing

```ts
import { hashPassword, verifyPassword } from "@blixis-io/auth";

const hash = await hashPassword(user.password); // "$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>"
const valid = await verifyPassword(candidatePassword, hash);
```

Argon2id via Node's own `crypto.argon2` (no external dependency), at OWASP's minimum recommended cost. The returned string stores its own parameters, so a future bump to the cost constants still verifies hashes minted under the old ones.

### The store interfaces

```ts
interface CredentialStore<Claims> {
  findByIdentifier(identifier: string): Promise<{ subject: string; passwordHash: string } | null | undefined>;
  loadClaims(subject: string): Promise<Claims | null | undefined>;
}

interface RefreshTokenStore {
  create(tokenHash: string, record: { subject: string; expiresAt: Date }): Promise<void>;
  find(tokenHash: string): Promise<RefreshTokenRecord | null | undefined>;
  markRotated(tokenHash: string): Promise<boolean>;
  revoke(tokenHash: string): Promise<void>;
  revokeAllForSubject(subject: string): Promise<void>;
}
```

`AuthService` never sees a raw password or a raw refresh token in your store — it hashes both before ever calling out (Argon2id for passwords, a fast SHA-256 for the high-entropy refresh token, since the latter doesn't need to be slow to resist brute force). `loadClaims` returning `null`/`undefined` means "this account can't sign in right now" (gone or disabled) and fails exactly like a wrong password — your store owns that decision, `@blixis-io/auth` just fails closed on it.

### Fail-closed rules, deliberate

- **`signIn` never reveals whether an identifier exists.** An unknown identifier still runs a real password verification (against an internally cached dummy hash) before rejecting, so response timing doesn't leak account existence. Unknown identifier, wrong password, and a disabled account (`loadClaims` returning null) all throw the identical `UnauthorizedException("Invalid credentials")`.
- **Refresh tokens rotate on every use.** `refresh()` invalidates the presented token and issues a new one. Presenting an **already-rotated** token — real reuse, or two callers racing to refresh the same token — revokes every refresh token for that subject and throws, on the theory that only the rightful client should ever hold the newest token.
- **`signOut` is idempotent.** Revoking an unknown or already-revoked token never throws.
- **A claims value that fails your own schema is a server bug, not a client error.** If `CredentialStore.loadClaims()` returns something your `claimsSchema` would reject, `AuthService` throws a plain `Error` (a `500`) instead of silently signing a token `JwtAuthGuard` would later reject anyway.

### What this deliberately doesn't do yet

This is a first pass, scoped to match what a real caller needs today rather than every guarantee a production identity system eventually wants — each gap below is a deliberate, named deferral:

- **Sign-in is unthrottled.** This is the one that matters most before going to production: `signIn` has no rate limiting or lockout built in. Add it at a proxy, or with an interceptor, before shipping password sign-in for real.
- **No rotation-family grace window.** Two tabs refreshing the same token at nearly the same instant will trip reuse detection and sign the user out everywhere — clients should single-flight their own refresh calls. There's also no absolute session cap; a session can slide indefinitely while actively used.
- **HMAC signing only**, same as verification — no asymmetric (EdDSA) signing or JWKS endpoint. Only relevant once more than one service needs to verify tokens without sharing the HMAC secret.
- **No security-event hook** for detected reuse — it's logged nowhere by `@blixis-io/auth` itself today. Wire your own logging into your store implementations if you need it.

## Next

- Every exported symbol: [`@blixis-io/auth` reference](/reference/blixis-auth/).
- The guard primitive this is built on: [Guards & Authorization](/concepts/guards-and-authorization/).
- Where verified claims live between guards, interceptors, and the handler: [Request Context](/concepts/request-context/).
- A full Drizzle-backed implementation: [Issuing Tokens guide](/guides/issuing-tokens/).
