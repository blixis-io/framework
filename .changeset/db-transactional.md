---
"@blixis-io/db": minor
---

New `@Transactional()` method decorator. The method runs in a database transaction: it commits when it resolves and rolls back when it throws, and calls to other `@Transactional` methods sharing the database join the outer transaction. No `tx` has to be passed around: the injected `DATABASE` is now a thin wrapper that sends each query to the current transaction (tracked per call chain with `AsyncLocalStorage`) and to the pool otherwise, so existing `this.db...` code is unchanged. The compiler rejects a method that doesn't return a promise; a missing or ambiguous database is a `TransactionalError`. Accepts Drizzle's transaction options (`isolationLevel`, `accessMode`, `deferrable`) and a `database` option for when the DATABASE isn't a direct property of the class.
