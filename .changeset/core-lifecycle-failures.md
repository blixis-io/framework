---
"@blixis-io/core": patch
"@blixis-io/di": patch
---

Two lifecycle failures no longer leak resources.

`app.close()` now runs **every** shutdown hook even when one throws. Before, the first failure aborted the rest, so a failing flush could leave the database pool open. One failure is rethrown as it is; several are rethrown together as an `AggregateError`.

A boot that fails part-way (a constructor, `onModuleInit` or `onApplicationBootstrap` throws) now shuts down the providers it had already built, dependents first, then rejects with the original error. Before, nothing was closed: a connection pool opened by an earlier provider kept the process alive for its idle timeout (10 seconds for `pg`), and `createFetchHandler` leaked one per failed boot attempt. A failure in a shutdown hook during that clean-up is logged with `console.error` and does not replace the boot error.

`@blixis-io/di`: `Container.resolveAll()` now waits for every in-flight resolution to settle before rejecting with the first failure, so providers still being built when one fails can be cleaned up.
