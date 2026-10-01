---
"@blixis-io/core": minor
---

Each dynamic registration (`forRoot()` result) is now its own module instance, so one module class can be imported several times with different configuration (e.g. two database connections). Previously the second registration was silently dropped and the first configuration won. Registrations must provide distinct tokens; a clash fails at boot with `DuplicateProviderError`. The class's static `@Module()` providers and controllers are registered once. `ProviderNotVisibleError` is now exported.
