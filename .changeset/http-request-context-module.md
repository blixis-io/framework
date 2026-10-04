---
"@blixis-io/http": minor
---

Export `RequestContextModule`, the global module `createHttpApplication` already used to provide `RequestContext`. Entry points that boot an app without the HTTP layer can now import it, so providers that inject `RequestContext` still resolve there.
