---
title: Database
description: Drizzle-backed persistence, connected and disconnected automatically via module lifecycle.
sidebar:
  order: 13
---

`@blixis-io/db` connects an app to Postgres through [Drizzle](https://orm.drizzle.team/), reusing the same `DynamicModule`/`forRoot()` pattern [Modules](/framework/concepts/modules/#dynamic-modules-the-forroot-pattern) and [Configuration](/framework/concepts/config/) already introduced — plus [Lifecycle Hooks](/framework/concepts/lifecycle-hooks/) to open and close the connection pool automatically.

## Why it's a factory, not a fixed token

Like `@blixis-io/config`, every app has its own schema — there's no single fixed type to export a token for. So `@blixis-io/db` exports a **function**, `defineDrizzleModule`, that builds one:

```ts
// db/schema.ts
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = { posts };
```

```ts
// db/index.ts
import { defineDrizzleModule } from "@blixis-io/db";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { schema } from "./schema.js";

export const { DATABASE, DrizzleModule } = defineDrizzleModule(schema);
export type Database = NodePgDatabase<typeof schema>;
```

`DATABASE` is a brand-new `InjectionToken<NodePgDatabase<typeof schema>>`, typed exactly to your schema — call `defineDrizzleModule` once, export the result, and import `DATABASE`/`DrizzleModule` from that one file everywhere else in the app.

## Connecting, and checking the connection actually works

```ts
@Module({ imports: [DrizzleModule.forRoot({ connection: process.env.DATABASE_URL })] })
class PostsModule {}
```

`forRoot()` opens a `pg.Pool` immediately and registers `DATABASE`, but it doesn't stop there — an internal `OnModuleInit` hook runs `SELECT 1` against the pool before `createApplication()` finishes resolving. A database that's down, or a bad connection string, fails **at boot** with `DbConnectionError`, not three requests into production on whichever handler happens to query first.

`connection` is passed through to `pg.Pool` — either a connection string or a full `PoolConfig` object (host/port/user/password/`max`/`connectionTimeoutMillis`/etc.), with one default added: a request for a connection waits at most **10 seconds** before failing. `pg` on its own waits forever, so an exhausted pool (every connection busy) or an unreachable database would leave requests hanging with no error. Set `connectionTimeoutMillis` yourself to change it, or `0` to wait indefinitely. The pool holds 10 connections by default (`max`); size it to your database's connection limit across all running instances.

## When a connection is lost

An idle connection can die while nothing is using it: the database restarts or fails over, the network drops, an administrator ends the session. `pg` reports that on the pool as an `error` event, and a pool with no listener makes Node throw it, which would crash the process. `forRoot()` always attaches a listener. The pool discards the dead connection and opens a new one the next time a query needs it, so the app keeps running and the next query works.

By default the error is written with `console.error`. Pass `onPoolError` to send it to your logger or an alerting hook:

```ts
DrizzleModule.forRoot({
  connection: process.env.DATABASE_URL,
  onPoolError: (error) => log.warn("idle database connection failed", { message: error.message }),
});
```

A handler that throws is caught and reported with `console.error`, so it can't bring the process down either. A connection that fails while a query is running isn't covered by this: that error is returned to the code that ran the query, as before.

## The pool closes itself too

The same internal provider implements `OnApplicationShutdown`, calling `pool.end()`. Since it's registered — just not exported — it's still eagerly resolved and still gets its shutdown hook run by `Application.close()`, exactly like every other provider. Nothing about closing the database is wired manually in `main.ts`; it falls out of the same lifecycle mechanism every other package uses.

## Transactions: `@Transactional()`

Put `@Transactional()` on an `async` method and everything it does through the injected `DATABASE` runs in one transaction: it commits when the method resolves and rolls back when it throws.

```ts
@Injectable()
class TransfersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Transactional()
  async transfer(from: string, to: string, cents: number): Promise<void> {
    await this.db.update(accounts).set({ balance: sql`balance - ${cents}` }).where(eq(accounts.id, from));
    await this.chargeFee(from); // a throw here undoes the update above
    await this.db.update(accounts).set({ balance: sql`balance + ${cents}` }).where(eq(accounts.id, to));
  }
}
```

Nothing else changes in how you write queries: no `tx` parameter to thread through. The `DATABASE` you inject is a thin wrapper over Drizzle's database that sends each query to the current transaction when there is one and to the pool otherwise. "Current" follows the call chain (it uses `AsyncLocalStorage`), so it holds across `await`s and inside `Promise.all`.

- **Nesting joins.** A `@Transactional` method called from another one, in the same class or a different service sharing the same database, joins the outer transaction instead of starting a second one. A failure anywhere rolls the whole thing back.
- **Options** go to Drizzle: `@Transactional({ isolationLevel: "serializable" })`, `accessMode`, `deferrable`.
- **The method must be `async`.** The compiler rejects one that doesn't return a promise.
- **How it finds the database.** The decorator looks for the injected `DATABASE` on the instance (`this`). If the class holds none, or holds two, you get a `TransactionalError` naming the method instead of a guess. When the database sits behind another object, say so: `@Transactional({ database: (self) => self.repo.db })`.
- **Separate connections stay separate.** Each application, and each `defineDrizzleModule()`, has its own wrapper, so a transaction in one is invisible to the other.
- **Writes are invisible outside until commit.** Other connections, and code running outside the transactional call chain, see the old data until the method resolves.

Two things to be careful with:

- **Events.** A handler triggered by `emit()` from inside a transactional method runs in the same call chain, so it joins the transaction and has already run if the transaction later rolls back. Emit after the method returns when listeners must only see committed data.
- **Explicit `db.transaction()` still works**, but it starts its own transaction on the pool connection it checks out; use one style or the other for a given piece of work.

## `global` is off by default

```ts
DrizzleModule.forRoot({ connection, global: true })
```

Unlike `ConfigModule`/`LoggerModule` (always `global: true`, since every app wants config and logging everywhere), `DrizzleModule.forRoot()` defaults to `global: false` — only the modules that actually import it can see `DATABASE`. Most apps have exactly one module that talks to the database directly (a repository-style service), so encapsulation is usually the better default; pass `global: true` explicitly if multiple unrelated modules genuinely need direct database access.

## Testing

`@blixis-io/testing`'s `Test.createModule({...}).compile()` builds a real `Application`, so a test using `DrizzleModule.forRoot()` connects to a real Postgres — there's no in-memory fake. A test suite typically resets state itself between tests (e.g. deleting every row from its own tables right after compiling) rather than mocking the database away; see the [hello-api walkthrough](/framework/examples/hello-api-walkthrough/#postspostse2etestts) for the pattern.

## Next

- Every exported symbol: [`@blixis-io/db` reference](/framework/reference/blixis-db/).
- See it wired into a real app: the [hello-api walkthrough](/framework/examples/hello-api-walkthrough/).
