---
"@blixis-io/http": patch
---

A boot that fails while building the HTTP handler (a duplicate route, a class without `@Controller()`, a `@GlobalGuard()` without `canActivate`) now shuts down the providers the core application had already initialised, then rejects with the original error. Before, their `onApplicationShutdown` hooks never ran, so a database pool opened during boot stayed open; with `createFetchHandler`, every retried boot added another. A hook that fails during this rollback is logged and does not replace the boot error.
