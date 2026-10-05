---
title: "@blixis-io/db"
description: Full API reference for the db package.
sidebar:
  order: 7
---

Drizzle-backed Postgres persistence, wired up the same `forRoot()` way as every other `DynamicModule` in this framework. See [Database](/framework/concepts/database/) for the concepts.

## `Transactional`

```ts
function Transactional(options?: TransactionalOptions): MethodDecorator /* async methods only */;

interface TransactionalOptions extends PgTransactionConfig {
  // Drizzle's own: isolationLevel, accessMode, deferrable
  database?: (instance) => unknown; // where the DATABASE is, when it isn't a direct property of the class
}

class TransactionalError extends Error {} // no DATABASE on the class, several of them, or `database` returned something else
```

Runs the method in a transaction: commit on resolve, rollback on throw. Nested `@Transactional` calls sharing a database join the outer one. The method has to return a promise (checked by the compiler). Always rejects rather than throwing synchronously. See [Database](/framework/concepts/database/#transactions-transactional).

## `defineDrizzleModule`

```ts
function defineDrizzleModule<Schema extends Record<string, unknown>>(
  schema: Schema,
): {
  DATABASE: InjectionToken<NodePgDatabase<Schema>>; // transaction-aware: queries go to the current @Transactional transaction, else the pool
  DrizzleModule: {
    forRoot(options: DrizzleModuleOptions): DynamicModule;
  };
};
```

Schema shape is inherently app-specific — unlike `@blixis-io/logging`'s single fixed `LOGGER` token, there's no one type to export a token for. Each call to `defineDrizzleModule(schema)` returns a **new**, distinct `InjectionToken` typed to that schema, plus a `DrizzleModule` class bound to it. Call it once per app (typically in its own `db/index.ts`), export both, and use them everywhere:

```ts
// db/index.ts
import { defineDrizzleModule } from "@blixis-io/db";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { schema } from "./schema.js";

export const { DATABASE, DrizzleModule } = defineDrizzleModule(schema);
export type Database = NodePgDatabase<typeof schema>;
```

## `DrizzleModuleOptions`

```ts
interface DrizzleModuleOptions {
  connection: string | PoolConfig; // from "pg"
  global?: boolean; // default false
  onPoolError?: (error: Error) => void; // default: console.error
}
```

`connection` is passed to `pg.Pool` — a connection string, or a full config object (`host`/`port`/`user`/`password`/`max`/`connectionTimeoutMillis`/etc.). One default is added: unless you set `connectionTimeoutMillis` (`0` means no limit), a request for a connection fails after 10 seconds, where `pg` on its own would wait forever when the pool is exhausted or the database is unreachable. `onPoolError` is called when the pool reports an error on an idle connection (see [Connection loss](/framework/concepts/database/#when-a-connection-is-lost)). `global` makes `DATABASE` visible to every module without each one importing `DrizzleModule` directly, same escape hatch as `LoggerModule`/`ConfigModule`; defaults to `false` since most apps only need direct database access from one module.

## `DrizzleModule.forRoot(options)`

```ts
@Module({ imports: [DrizzleModule.forRoot({ connection: process.env.DATABASE_URL })] })
class PostsModule {}
```

Opens a `pg.Pool` and registers `DATABASE` immediately. Internally, an unexported provider owning that pool implements `OnModuleInit` (runs `SELECT 1`, throwing `DbConnectionError` on failure — fails at boot, not on first query) and `OnApplicationShutdown` (calls `pool.end()`). Both hooks run automatically as part of the normal `Application` lifecycle; nothing extra needs wiring in `main.ts`.

## `DbConnectionError`

```ts
class DbConnectionError extends Error {
  constructor(cause: unknown);
}
```

Thrown from the internal `OnModuleInit` hook when the initial `SELECT 1` connectivity check fails. `cause` is the underlying error (e.g. from `pg`); the message includes its text.

## Injecting it

```ts
import { Inject, Injectable } from "@blixis-io/di";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "./db/index.js";
import { posts } from "./db/schema.js";

@Injectable()
class PostsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  list() {
    return this.db.select().from(posts);
  }

  get(id: number) {
    return this.db.select().from(posts).where(eq(posts.id, id));
  }
}
```

`db` is a real `NodePgDatabase<Schema>` — every Drizzle query-builder method (`select`/`insert`/`update`/`delete`/`execute`/`transaction`) is available exactly as documented by [Drizzle](https://orm.drizzle.team/docs/rqb) itself; `@blixis-io/db` only owns connecting and disconnecting it.
