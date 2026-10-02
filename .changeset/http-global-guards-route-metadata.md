---
"@blixis-io/http": minor
---

Guards and interceptors now receive `controller` and `handler` in their `ExecutionContext`, so they can tell which route is being handled. New `SetRouteMetadata(key, value)` / `getRouteMetadata(key, context)` attach metadata to a controller or a single route and read it back (the method's own value wins, else the controller's): the building block for decorators such as `@Roles` and `@Public`. New `@GlobalGuard()` marks a guard that runs on every route before the route's own guards; it is found among the application's providers (so it still has to be registered), several run in dependency order, and a marked class without `canActivate()` fails the boot. **Type-level change:** code that builds an `ExecutionContext` by hand (typically a unit test) now needs `controller` and `handler` too.
