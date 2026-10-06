---
title: Authentication
description: JWT verification and role-based access control via JwtAuthGuard and createRolesGuard.
sidebar:
  order: 14
---

`@blixis-io/auth` verifies bearer JWTs and checks roles, built entirely on primitives [Guards & Authorization](/framework/concepts/guards-and-authorization/) and [Request Context](/framework/concepts/request-context/) already introduced — it's app-layer, not a framework dependency: `@blixis-io/http` has no idea `@blixis-io/auth` exists.

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

`JwtAuthGuard` reads the `Authorization` header (the `Bearer` scheme, in any letter case, as RFC 7235 allows), verifies the token (HMAC — `HS256` by default, or `HS384`/`HS512`) against the `secret` from `forRoot()`, and validates the decoded payload against your claims schema. A token must carry an `exp` claim: one that never expires is refused even with a valid signature. Any failure — missing header, bad signature, expired token, a payload that fails the schema — throws `UnauthorizedException` (a real `401`), never a plain `false`: a bad token is a client authentication failure, not a generic "denied," so it gets its own status rather than folding into a guard's usual `403`. The response carries a `WWW-Authenticate` challenge as RFC 9110 requires: `Bearer` when no token was sent, `Bearer error="invalid_token"` when one was sent and failed (RFC 6750). Sign-in (`AuthService.signIn`) returns a plain `401` with no challenge, since its credentials travel in the request body rather than an `Authorization` header.

### The secret, the issuer and the audience

`forRoot()` refuses a weak secret at boot with `AuthConfigError`: at least **32 bytes** for `HS256`, 48 for `HS384`, 64 for `HS512` (RFC 7518, section 3.2; counted in bytes of the UTF-8 text). The error gives the length, never the value. Generate one at random, for example `openssl rand -base64 48` (64 characters, enough for every algorithm), and keep it in the environment, not in the repository.

Two optional settings stop one app's tokens being accepted by another that happens to share a secret (staging and production, two services):

```ts
AuthModule.forRoot({
  secret: process.env.JWT_SECRET!,
  issuer: "https://auth.example.com", // the token's `iss` must be exactly this
  audience: "orders-api", // the token's `aud` must list this (or any of them, if you pass an array)
});
```

When set, a token without the claim or with a different value is a `401`, and tokens issued by `AUTH_SERVICE` carry them. When unset, `iss` and `aud` are neither checked nor added.

On success, the verified claims are stored in [`RequestContext`](/framework/concepts/request-context/) for the rest of the request. Read them back with `getCurrentUser`:

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

Role-based access is a **second guard**, not a decorator — consistent with this framework's guard-is-the-authorization-primitive philosophy (see [Guards & Authorization](/framework/concepts/guards-and-authorization/)) rather than introducing a parallel `@Roles()` metadata system:

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

`createRolesGuard(...roles)` returns a **fresh class each call** — same shape as `defineConfigModule` returning an app-specific class from a closure. Assign it to a named export and list it in `providers`, exactly like any other guard — leaving a guard class out of `providers` is the single most common mistake with `@UseGuards`, see [Guards & Authorization](/framework/concepts/guards-and-authorization/#guard-classes-must-be-registered-providers).

`AdminGuard` must run **after** `JwtAuthGuard` in the same `@UseGuards(...)` list: guards run sequentially and short-circuit, so by the time `AdminGuard` checks `getCurrentUser(ctx).roles`, `JwtAuthGuard` has already populated it. If no user is in `RequestContext` yet — guards misordered, or `JwtAuthGuard` left off entirely — `AdminGuard` throws `UnauthorizedException` rather than silently returning `false`, since "no identity at all" and "identity, but wrong role" are different failures worth telling apart.

A user with none of the required roles gets a plain `false` — same as any other guard denial — which the framework turns into `403 Forbidden`.

## `@Roles` and `@Public`, and protecting everything

`createRolesGuard` needs a guard class per role set, registered by hand and ordered after the auth guard. The decorators do the same job with less ceremony. `AuthGuard` (returned by `defineAuthModule`) authenticates the request, then enforces `@Roles(...)` if the route has one:

```ts
@Controller("admin")
@UseGuards(AuthGuard)
export class AdminController {
  @Get("users")
  @Roles("admin", "support") // at least one of these
  users() { /* ... */ }

  @Get("ping")
  @Public() // no token needed
  ping() { return "pong"; }
}
```

An unauthenticated request is a `401`, a request without the role is a `403`. `@Roles` on a controller covers every route in it; a route's own `@Roles` replaces it, and `@Public()` on a route overrides everything above it.

To make **every** route require a token without touching each controller, opt in with `protectAllRoutes`:

```ts
AuthModule.forRoot({ secret: process.env.JWT_SECRET!, protectAllRoutes: true })
```

Now an undecorated route answers `401` without a token, and the routes that must stay open say so with `@Public()`: your login and refresh routes, a health check. That is the point of the default: a controller added later can't be forgotten and left open. It is off by default, so enabling it is a deliberate change; until you do, nothing about existing routes changes, and `@Roles` only takes effect on routes that carry `@UseGuards(AuthGuard)`.

Things to know:

- `@Public()` skips authentication entirely, so a valid token sent to a public route is not read and `getCurrentUser` is `undefined` there.
- Roles come from the token's `roles` claim, which must be an array of strings. A token without it fails any `@Roles` check with `403`.
- `protectAllRoutes` uses the `@GlobalGuard()` mechanism from `@blixis-io/http` (see [Guards & Authorization](/framework/concepts/guards-and-authorization/#global-guards)). Routes mounted with `app.mount()`, such as `serveOpenApi`, bypass guards and stay public.
- `JwtAuthGuard` and `createRolesGuard` are unchanged and still work.

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

See the [Issuing Tokens guide](/framework/guides/issuing-tokens/) for a full working `CredentialStore`/`RefreshTokenStore` pair backed by Drizzle, plus a sign-up flow using `hashPassword`.

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
  create(tokenHash: string, record: { subject: string; expiresAt: Date; familyId: string }): Promise<void>;
  find(tokenHash: string): Promise<RefreshTokenRecord | null | undefined>;
  markRotated(tokenHash: string): Promise<boolean>;
  revoke(tokenHash: string): Promise<void>;
  revokeAllForSubject(subject: string): Promise<void>;
  // optional, see "Making rotation resilient" in the Issuing Tokens guide:
  rotate?(oldTokenHash: string, next: { tokenHash: string; subject: string; expiresAt: Date; familyId: string }): Promise<boolean>;
  revokeFamily?(familyId: string): Promise<void>;
}
```

`AuthService` never sees a raw password or a raw refresh token in your store — it hashes both before ever calling out (Argon2id for passwords, a fast SHA-256 for the high-entropy refresh token, since the latter doesn't need to be slow to resist brute force). `loadClaims` returning `null`/`undefined` means "this account can't sign in right now" (gone or disabled) and fails exactly like a wrong password — your store owns that decision, `@blixis-io/auth` just fails closed on it.

### Fail-closed rules, deliberate

- **`signIn` never reveals whether an identifier exists.** An unknown identifier still runs a real password verification (against an internally cached dummy hash) before rejecting, so response timing doesn't leak account existence. Unknown identifier, wrong password, and a disabled account (`loadClaims` returning null) all throw the identical `UnauthorizedException("Invalid credentials")`.
- **Refresh tokens rotate on every use.** `refresh()` invalidates the presented token and issues a new one. Presenting an **already-rotated** token — real reuse, or two callers racing to refresh the same token — revokes that login and throws, on the theory that only the rightful client should ever hold the newest token. "That login" is its family (every token descended from one sign-in) if your store implements `revokeFamily`, so the user's other devices stay signed in; otherwise it is every refresh token of the subject. With `refreshReuseGraceSeconds` set, a token rotated within that window is just refused, and nothing is revoked.
- **A failure part-way never strands the client.** Everything that can fail without leaving a trace (loading the claims, signing the access token) happens before anything is written. Then the successor is stored and the old token marked rotated, atomically if your store implements `rotate`; without it the successor is stored *first*, so a failure leaves the old token usable (and at worst an unused successor), never a client with no valid token.
- **`signOut` is idempotent.** Revoking an unknown or already-revoked token never throws.
- **A claims value that fails your own schema is a server bug, not a client error.** If `CredentialStore.loadClaims()` returns something your `claimsSchema` would reject, `AuthService` throws a plain `Error` (a `500`) instead of silently signing a token `JwtAuthGuard` would later reject anyway.

### What this deliberately doesn't do yet

This is a first pass, scoped to match what a real caller needs today rather than every guarantee a production identity system eventually wants — each gap below is a deliberate, named deferral:

- **Sign-in is unthrottled.** This is the one that matters most before going to production: `signIn` has no rate limiting or lockout built in. Add it at a proxy, or with an interceptor, before shipping password sign-in for real.
- **The grace window is off by default.** Two tabs refreshing the same token at nearly the same instant trip reuse detection and end that login (just that login, if the store keeps families; every session otherwise). Set `refreshReuseGraceSeconds` to refuse the second request without revoking anything, and have clients single-flight their own refresh calls anyway. There's also no absolute session cap; a session can slide indefinitely while actively used.
- **Revoking refresh tokens does not revoke access tokens already issued.** A signed access token is valid until its `exp`; sign-out and reuse revocation only stop new ones being minted. Keep `accessTokenTtl` short (the default is 15 minutes) for that reason.
- **HMAC signing only**, same as verification — no asymmetric (EdDSA) signing or JWKS endpoint. Only relevant once more than one service needs to verify tokens without sharing the HMAC secret.
- **No security-event hook** for detected reuse — it's logged nowhere by `@blixis-io/auth` itself today. Wire your own logging into your store implementations if you need it.

## Next

- Every exported symbol: [`@blixis-io/auth` reference](/framework/reference/blixis-auth/).
- The guard primitive this is built on: [Guards & Authorization](/framework/concepts/guards-and-authorization/).
- Where verified claims live between guards, interceptors, and the handler: [Request Context](/framework/concepts/request-context/).
- A full Drizzle-backed implementation: [Issuing Tokens guide](/framework/guides/issuing-tokens/).
