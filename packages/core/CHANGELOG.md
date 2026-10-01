# @blixis-io/core

## 0.2.0

### Minor Changes

- [#25](https://github.com/blixis-io/framework/pull/25) [`cbc09de`](https://github.com/blixis-io/framework/commit/cbc09de1c8b2fa16d183f2d3b95d0e922c44e7e7) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Each dynamic registration (`forRoot()` result) is now its own module instance, so one module class can be imported several times with different configuration (e.g. two database connections). Previously the second registration was silently dropped and the first configuration won. Registrations must provide distinct tokens; a clash fails at boot with `DuplicateProviderError`. The class's static `@Module()` providers and controllers are registered once. `ProviderNotVisibleError` is now exported.
