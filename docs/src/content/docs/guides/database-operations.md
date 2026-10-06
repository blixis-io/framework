---
title: Database operations
description: Migrations and deploy order, pool sizing across replicas, query deadlines, transactions and recovery, with what is tested and what is general Postgres practice.
sidebar:
  order: 8.8
---

How the database behaves in production, as opposed to how to query it ([Database](/framework/concepts/database/) covers that). The examples use `examples/saas-api`, which does all of this and tests most of it. Where a claim here is general Postgres practice and not something this repository runs, it says so.

## Migrations

**Run them as a deploy step, once, before the new version starts. Not from every replica at boot.** Two replicas migrating at once race each other, and, worse, a schema change that races a still-running old version is a deploy-ordering problem no lock can solve. In `saas-api` that step is `blix run db:migrate`, a [`@Command`](/framework/guides/writing-commands/) that boots the app and calls a small `migrate()` function.

What `migrate()` does (read `examples/saas-api/src/db/migrate.ts`; it is about 60 lines you can copy):

- Plain `.sql` files in a directory, applied in name order, each in **its own transaction**, so a file that fails halfway leaves nothing behind and is not recorded; fix it and run again.
- A table of applied names. Files are **never edited after release**: a new change is a new file.
- A Postgres **advisory lock**, taken before anything else, so two runs at once apply each file once. Take it before the very first statement: `create schema if not exists` is not safe against itself when two sessions run it at the same moment on a database that lacks the schema (one fails with a duplicate-key error). A CI database starts empty, so a test run is exactly that case; the example's test reproduces the failure without the lock.

You can use `drizzle-kit` or any other migration tool instead. The rule that matters is who runs it and when, not which tool.

### Old and new run together

During a rolling deploy the old version serves traffic against the **new** schema until it is replaced. So a migration must work with the old code too:

- **Add** columns as nullable or with a default, and tables and indexes freely. Ship the code that uses them in the same release or the next.
- **Rename or drop** in two releases: the first stops using the old column (and adds the new one), the second, once nothing runs the old code, removes it.
- Create indexes on a busy table with `create index concurrently`: a plain `create index` blocks writes while it builds. It cannot run inside a transaction, and the example's runner wraps every file in one, so it cannot apply such a statement; run it outside the runner, or give your runner a mode without a transaction. General Postgres practice, not run here.

## Pool sizing

`DrizzleModule.forRoot({ connection })` takes a `pg` `PoolConfig`, so `max` is the most connections one instance opens (`pg`'s default is 10). The arithmetic that bites:

> instances × `max` + migrations + admin tools + other services, all under Postgres's `max_connections`

Ten replicas at the default want 100, which is Postgres's default limit. Size `max` from the database's limit, not from "enough". A burst beyond `max` waits for a free connection instead of opening more (tested: six queries on a pool of two never saw more than two connections), and a wait longer than `connectionTimeoutMillis` fails the request (the module sets 10 s unless you say otherwise; `pg` alone would wait forever).

Serverless platforms start many short-lived instances, each with its own pool, and can exhaust the database quickly. Put a pooler such as PgBouncer in front and keep `max` small. A pooler in transaction mode is fine for `@Transactional` (one transaction is one connection) but not for session state: session-level advisory locks, `set` without `local`, prepared statements across transactions. General practice, not run here.

## Deadlines

A request that waits forever on the database holds a connection and a user. Two settings give it a limit:

```ts
DrizzleModule.forRoot({
  connection: {
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5_000, // waiting for a free connection
    statement_timeout: 10_000, // a single statement, enforced by Postgres
  },
});
```

`statement_timeout` is what actually **stops** a slow query: Postgres cancels it (error code `57014`) and the pool carries on (tested). `requestTimeout` on the HTTP side answers the client `504` but cannot cancel a query already running, so keep `statement_timeout` **shorter** than `requestTimeout`, or a timed-out request leaves its query running. Postgres also has `idle_in_transaction_session_timeout`, which ends a transaction a crashed or stuck client left open; set it in the database or the role. General practice, not run here.

## Transactions

`@Transactional()` is described in [Database](/framework/concepts/database/#transactions-transactional). Operationally:

- Keep a transaction **short** and free of slow calls (an HTTP request, an email). It holds a connection and its locks for as long as it runs.
- A nested `@Transactional` call joins the outer transaction; one failure rolls everything back.
- Do things that must only happen after commit (issuing tokens, emitting an event, sending mail) **after** the transactional method returns. `saas-api`'s sign-up does: the account is created in one transaction, and the tokens are issued once it has committed.
- A statement that fails inside a transaction aborts it; the next statement in it fails with `current transaction is aborted` until it rolls back. Let the exception propagate rather than catching it and carrying on.

## When the database goes away

- **At boot** a database that cannot be reached fails the start (`DbConnectionError`), which is what you want from a deploy.
- **While running**, an idle connection that drops (restart, failover, a network blip) is reported to `onPoolError`, discarded and replaced on demand; it does not crash the process. A query that was *running* on it fails and its error reaches the caller. Wire `onPoolError` to your logger.
- **Readiness** should say so: register a `select 1` check with [`@blixis-io/health`](/framework/guides/health-checks/), so a balancer stops sending traffic while the database is unreachable, without restarting instances (liveness stays up).
- **Shutdown** closes the HTTP server first, lets in-flight requests finish, then ends the pool, in that order, because the database provider's shutdown hook runs after the requests are done ([Running in Production](/framework/guides/running-in-production/)).

## What is and isn't verified here

Tested against a real Postgres: the migration function (once, in order, under concurrency, on an empty database, rollback of a failing file), `statement_timeout` cancelling a query without harming the pool, `max` bounding connections, `connectionTimeoutMillis` failing a wait, pool errors not crashing the process. Not run: a real failover, PgBouncer, `create index concurrently` on a large table, `idle_in_transaction_session_timeout`, a rolling deploy with old and new versions side by side.
