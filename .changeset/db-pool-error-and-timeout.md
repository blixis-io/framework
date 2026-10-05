---
"@blixis-io/db": minor
---

An idle Postgres connection that dies (database restart or failover, a network drop, an administrator ending the session) no longer crashes the process. `pg` re-emits that error on the pool, and with no listener Node threw it as an unhandled `error` event. `DrizzleModule.forRoot()` now always listens: the error goes to the new `onPoolError(error)` option, default `console.error`, and the pool opens a replacement connection on the next query.

New default: a request for a connection now fails after 10 seconds (`connectionTimeoutMillis`) instead of waiting forever when the pool is exhausted or the database is unreachable. Set `connectionTimeoutMillis` yourself to change it, or `0` for the old behaviour of no limit. Apps with a database that can take longer than 10 seconds to accept a connection (a serverless database waking from idle, for example) should raise it.
