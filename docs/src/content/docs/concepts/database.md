---
title: Database
description: Drizzle-backed persistence, connected and disconnected automatically via module lifecycle.
sidebar:
  order: 13
---

`@blixis/db` connects an app to Postgres through [Drizzle](https://orm.drizzle.team/), reusing the same `DynamicModule`/`forRoot()` pattern [Modules](/concepts/modules/#dynamic-modules-the-forroot-pattern) and [Configuration](/concepts/config/) already introduced — plus [Lifecycle Hooks](/concepts/lifecycle-hooks/) to open and close the connection pool automatically.

## Why it's a factory, not a fixed token

Like `@blixis/config`, every app has its own schema — there's no single fixed type to export a token for. So `@blixis/db` exports a **function**, `defineDrizzleModule`, that builds one:

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
import { defineDrizzleModule } from "@blixis/db";
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

`connection` is passed straight through to `pg.Pool` — either a connection string or a full `PoolConfig` object (host/port/user/password/`connectionTimeoutMillis`/etc.).

## The pool closes itself too

The same internal provider implements `OnApplicationShutdown`, calling `pool.end()`. Since it's registered — just not exported — it's still eagerly resolved and still gets its shutdown hook run by `Application.close()`, exactly like every other provider. Nothing about closing the database is wired manually in `main.ts`; it falls out of the same lifecycle mechanism every other package uses.

## `global` is off by default

```ts
DrizzleModule.forRoot({ connection, global: true })
```

Unlike `ConfigModule`/`LoggerModule` (always `global: true`, since every app wants config and logging everywhere), `DrizzleModule.forRoot()` defaults to `global: false` — only the modules that actually import it can see `DATABASE`. Most apps have exactly one module that talks to the database directly (a repository-style service), so encapsulation is usually the better default; pass `global: true` explicitly if multiple unrelated modules genuinely need direct database access.

## Testing

`@blixis/testing`'s `Test.createModule({...}).compile()` builds a real `Application`, so a test using `DrizzleModule.forRoot()` connects to a real Postgres — there's no in-memory fake. A test suite typically resets state itself between tests (e.g. deleting every row from its own tables right after compiling) rather than mocking the database away; see the [hello-api walkthrough](/examples/hello-api-walkthrough/#postspostse2etestts) for the pattern.

## Next

- Every exported symbol: [`@blixis/db` reference](/reference/blixis-db/).
- See it wired into a real app: the [hello-api walkthrough](/examples/hello-api-walkthrough/).
