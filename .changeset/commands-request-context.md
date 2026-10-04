---
"@blixis-io/commands": minor
---

`blix run` now provides `RequestContext` when `@blixis-io/http` is installed. Before, any app with a guard or service injecting `RequestContext` failed the whole boot with `No provider for "RequestContext"`, so none of its commands could run. It reads empty outside a request (`get` is `undefined`, `set` throws). `@blixis-io/http` is now an optional peer dependency, resolved like core and di so the app and `blix run` share one copy; apps without it boot as before.
