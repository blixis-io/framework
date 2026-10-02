---
"@blixis-io/core": minor
---

New `OnApplicationBootstrap` lifecycle hook and `Application.resolved()`. `onApplicationBootstrap(app)` runs once, after every provider has been created and every `onModuleInit` has finished, and receives an application whose `resolved()` lists every singleton provider instance with its token (and `get()` reaches any provider). It is the hook for discovery: scanning providers for a decorator and wiring them up, which is how `@Command` and `@OnEvent` will work. Exports `hasOnApplicationBootstrap`, `OnApplicationBootstrap` and `BootstrapContext`.
