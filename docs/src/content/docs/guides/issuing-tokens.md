---
title: Issuing Tokens
description: A Drizzle-backed CredentialStore and RefreshTokenStore for @blixis-io/auth's password sign-in and refresh rotation.
sidebar:
  order: 11
---

`@blixis-io/auth`'s `issuing` option needs two small stores. This walks through a real [Drizzle](https://orm.drizzle.team) implementation on top of [`@blixis-io/db`](/framework/concepts/database/) — the same pattern works with any database, `@blixis-io/auth` never depends on Drizzle itself. See [Authentication § Issuing tokens](/framework/concepts/authentication/#issuing-tokens) for the concepts and fail-closed rules this builds on.

## 1. The schema

```ts title="src/db/schema.ts"
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
});

export const credentials = pgTable("credentials", {
  userId: text("user_id").primaryKey(),
  passwordHash: text("password_hash").notNull(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
```

`credentials` is split from `users` — most of your app reads `users` constantly and should never touch a password hash column, even by accident. `refresh_tokens` stores only `tokenHash` (a SHA-256 hex digest `AuthService` computes) — the raw refresh token is never persisted anywhere.

```ts title="src/db/index.ts"
import { defineDrizzleModule } from "@blixis-io/db";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { credentials, refreshTokens, users } from "./schema.js";

const schema = { users, credentials, refreshTokens };
export const { DATABASE, DrizzleModule } = defineDrizzleModule(schema);
export type Database = NodePgDatabase<typeof schema>;
```

Same `defineDrizzleModule` factory as [Database](/framework/concepts/database/) — nothing issuing-specific here yet.

## 2. The stores

```ts title="src/auth/credential-store.ts"
import { DATABASE, type Database } from "../db/index.js";
import { credentials, users } from "../db/schema.js";
import { Inject, Injectable } from "@blixis-io/di";
import type { CredentialStore } from "@blixis-io/auth";
import type { AppClaims } from "./auth.js";
import { eq } from "drizzle-orm";

@Injectable()
export class DrizzleCredentialStore implements CredentialStore<AppClaims> {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findByIdentifier(email: string) {
    const rows = await this.db
      .select({ subject: users.id, passwordHash: credentials.passwordHash })
      .from(users)
      .innerJoin(credentials, eq(credentials.userId, users.id))
      .where(eq(users.email, email))
      .limit(1);
    return rows[0] ?? null;
  }

  async loadClaims(subject: string) {
    const rows = await this.db.select().from(users).where(eq(users.id, subject)).limit(1);
    const user = rows[0];
    return user ? { sub: user.id, email: user.email } : null;
  }
}
```

```ts title="src/auth/refresh-token-store.ts"
import { DATABASE, type Database } from "../db/index.js";
import { refreshTokens } from "../db/schema.js";
import { Inject, Injectable } from "@blixis-io/di";
import type { RefreshTokenStore } from "@blixis-io/auth";
import { and, eq, isNull } from "drizzle-orm";

@Injectable()
export class DrizzleRefreshTokenStore implements RefreshTokenStore {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(tokenHash: string, record: { subject: string; expiresAt: Date }) {
    await this.db.insert(refreshTokens).values({ tokenHash, userId: record.subject, expiresAt: record.expiresAt });
  }

  async find(tokenHash: string) {
    const rows = await this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).limit(1);
    const row = rows[0];
    return row
      ? { subject: row.userId, expiresAt: row.expiresAt, rotatedAt: row.rotatedAt, revokedAt: row.revokedAt }
      : null;
  }

  async markRotated(tokenHash: string) {
    const result = await this.db
      .update(refreshTokens)
      .set({ rotatedAt: new Date() })
      .where(
        and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.rotatedAt), isNull(refreshTokens.revokedAt)),
      )
      .returning({ tokenHash: refreshTokens.tokenHash });
    return result.length > 0;
  }

  async revoke(tokenHash: string) {
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, tokenHash));
  }

  async revokeAllForSubject(subject: string) {
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.userId, subject));
  }
}
```

`markRotated`'s `UPDATE ... WHERE rotated_at IS NULL AND revoked_at IS NULL RETURNING` is the whole trick — Postgres's own row locking makes this genuinely atomic. Two concurrent refreshes of the identical token both issue this statement; Postgres serializes them, and only the first to commit actually updates a row (the second's `WHERE` no longer matches once it re-evaluates against the just-committed row, so it affects zero rows and `result.length > 0` is `false`). No application-level locking needed — verified directly against a real Postgres instance, including running two `AuthService.refresh()` calls concurrently and confirming exactly one succeeds.

## 3. Wiring it in

```ts title="src/auth/auth.ts"
import { defineAuthModule } from "@blixis-io/auth";
import { z } from "zod";

export const ClaimsSchema = z.object({ sub: z.string(), email: z.string() });
export type AppClaims = z.infer<typeof ClaimsSchema>;

export const { AuthModule, AUTH_SERVICE, JwtAuthGuard, getCurrentUser } = defineAuthModule(ClaimsSchema);
```

```ts title="src/app.module.ts"
import { Module } from "@blixis-io/core";
import { DrizzleModule } from "./db/index.js";
import { AuthModule } from "./auth/auth.js";
import { DrizzleCredentialStore } from "./auth/credential-store.js";
import { DrizzleRefreshTokenStore } from "./auth/refresh-token-store.js";

// Call forRoot() once and reuse the same DynamicModule reference below —
// calling it a second time would open a second, separate connection pool.
const dbModule = DrizzleModule.forRoot({ connection: process.env.DATABASE_URL! });

@Module({
  imports: [
    dbModule,
    AuthModule.forRoot({
      secret: process.env.JWT_SECRET!,
      issuing: {
        imports: [dbModule], // so the stores' own @Inject(DATABASE) resolves
        credentialStore: DrizzleCredentialStore,
        refreshTokenStore: DrizzleRefreshTokenStore,
      },
    }),
  ],
})
export class AppModule {}
```

The `issuing.imports` matters: `credentialStore`/`refreshTokenStore` are registered as providers *of `AuthModule`*, a separate module in the graph from wherever the rest of the app gets `DATABASE` — without listing the same `dbModule` here too, `@Inject(DATABASE)` in either store throws `ProviderNotVisibleError` at boot (or `MissingProviderError`, if nothing else in the app imports it either). Verified directly against a real running app with this exact reused-reference shape. Calling `DrizzleModule.forRoot(...)` a *second* time instead (one call for `imports`, a separate call for `issuing.imports`) would still satisfy both module's visibility checks, but `forRoot()`'s own implementation opens a fresh `pg.Pool` per call — so that shape would silently run two separate connection pools against the same database. Always share one `dbModule` reference.

## 4. The controller

```ts title="src/auth/auth.controller.ts"
import { Body, Controller, HttpCode, Post } from "@blixis-io/http";
import { Inject } from "@blixis-io/di";
import { hashPassword, type AuthService } from "@blixis-io/auth";
import { z } from "zod";
import { AUTH_SERVICE } from "./auth.js";
import { DATABASE, type Database } from "../db/index.js";
import { credentials, users } from "../db/schema.js";

const SignInSchema = z.object({ email: z.string(), password: z.string() });
const SignUpSchema = SignInSchema;
const RefreshSchema = z.object({ refreshToken: z.string() });

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AUTH_SERVICE) private readonly auth: AuthService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  @Post("sign-up")
  async signUp(@Body(SignUpSchema) body: z.infer<typeof SignUpSchema>) {
    const id = crypto.randomUUID();
    await this.db.insert(users).values({ id, email: body.email });
    await this.db.insert(credentials).values({ userId: id, passwordHash: await hashPassword(body.password) });
    return this.auth.issueTokens(id);
  }

  @Post("sign-in")
  signIn(@Body(SignInSchema) body: z.infer<typeof SignInSchema>) {
    return this.auth.signIn(body.email, body.password);
  }

  @Post("refresh")
  refresh(@Body(RefreshSchema) body: z.infer<typeof RefreshSchema>) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post("sign-out")
  @HttpCode(204)
  signOut(@Body(RefreshSchema) body: z.infer<typeof RefreshSchema>) {
    return this.auth.signOut(body.refreshToken);
  }
}
```

`sign-up` writes both rows itself, then calls `issueTokens` — it doesn't go through `signIn`, since the password was just verified by virtue of being the one the caller just chose. This is also where you'd add sign-up-specific checks (email format, password strength, an already-registered email) before ever calling `hashPassword`.

## Making rotation resilient

The store above is the simplest one that works. Three things make it hold up when something fails or two requests overlap. All are optional and backward compatible: a store that implements none of them behaves as before, except that a failure part-way is safer (the successor is stored before the old token is marked rotated).

**1. Rotate in one transaction.** Implement `rotate(oldTokenHash, next)`: mark the old token rotated (the same compare-and-set as `markRotated`) and insert `next` in one transaction, returning `false` and writing nothing if the old token was already rotated or revoked. A failure then leaves the old token untouched, so the client simply retries.

**2. Keep families.** `create` receives a `familyId`: one per sign-in, kept by every rotation. Store it, implement `revokeFamily(familyId)`, and reuse of a stolen token ends *that* login instead of signing the user out of every device.

**3. Decide on a grace window.** An honest client can refresh twice at once (two tabs, or a retry because the first response was lost). By default that looks like theft and ends the login. `refreshReuseGraceSeconds: 10` makes a token rotated in the last 10 seconds a plain `401` that revokes nothing; the client still holds the newer token from the first response. The cost: a stolen token replayed inside that window is also only refused, not punished. Keep it small, and have clients single-flight their refresh calls anyway.

A complete Postgres store with all three, written against `pg`, is [`postgres-refresh-store.example.ts`](https://github.com/blixis-io/framework/blob/main/packages/auth/src/postgres-refresh-store.example.ts). It is not part of the package; copy it. It is tested against a real database in [`postgres-refresh-store.test.ts`](https://github.com/blixis-io/framework/blob/main/packages/auth/src/postgres-refresh-store.test.ts): twelve simultaneous refreshes of one token produce exactly one winner, a failed write of the successor leaves the old token valid and unrotated, replaying one device's old token leaves the others signed in, sign-out is idempotent, and expired tokens are refused.

What this does not do: revoking refresh tokens does not invalidate **access tokens already issued**. They stay valid until `exp`, so keep `accessTokenTtl` short. If a client's refresh response is lost *and* it retries after the grace window, it is signed out and must sign in again.

## Before this goes to production

**Rate-limit `sign-in`.** Nothing above throttles repeated attempts — that's explicitly out of scope for this pass, see [Authentication § What this deliberately doesn't do yet](/framework/concepts/authentication/#what-this-deliberately-doesnt-do-yet). Add it at a proxy or with an interceptor before shipping this for real.
