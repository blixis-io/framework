# @blixis-io/core

## 0.3.0

### Minor Changes

- [#46](https://github.com/blixis-io/framework/pull/46) [`4c34195`](https://github.com/blixis-io/framework/commit/4c34195a621dabc5d2f31e7a4eeed54a2dbc6d45) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - New `OnApplicationBootstrap` lifecycle hook and `Application.resolved()`. `onApplicationBootstrap(app)` runs once, after every provider has been created and every `onModuleInit` has finished, and receives an application whose `resolved()` lists every singleton provider instance with its token (and `get()` reaches any provider). It is the hook for discovery: scanning providers for a decorator and wiring them up, which is how `@Command` and `@OnEvent` will work. Exports `hasOnApplicationBootstrap`, `OnApplicationBootstrap` and `BootstrapContext`.

## 0.2.1

### Patch Changes

- [#42](https://github.com/blixis-io/framework/pull/42) [`fe1f67a`](https://github.com/blixis-io/framework/commit/fe1f67af5657af8d0d2a1ba8ca0aef400617d597) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Loading two copies of `@blixis-io/di` or `@blixis-io/core` into one process now fails at import with a `DuplicatePackageError` that names both copies (version and location) and the fix. Before, a version skew (for example upgrading `@blixis-io/http` without `@blixis-io/core`) installed two copies with separate DI metadata and failed much later with a misleading `NotAModuleError: ... did you forget @Module()?`. The check only catches a duplicate when both copies include it. Exports `assertSingleInstance`, `DuplicatePackageError` and `packageVersion` from `@blixis-io/di` for other packages to reuse.
- Updated dependencies [[`fe1f67a`](https://github.com/blixis-io/framework/commit/fe1f67af5657af8d0d2a1ba8ca0aef400617d597)]:
  - @blixis-io/di@0.1.1

## 0.2.0

### Minor Changes

- [#25](https://github.com/blixis-io/framework/pull/25) [`cbc09de`](https://github.com/blixis-io/framework/commit/cbc09de1c8b2fa16d183f2d3b95d0e922c44e7e7) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Each dynamic registration (`forRoot()` result) is now its own module instance, so one module class can be imported several times with different configuration (e.g. two database connections). Previously the second registration was silently dropped and the first configuration won. Registrations must provide distinct tokens; a clash fails at boot with `DuplicateProviderError`. The class's static `@Module()` providers and controllers are registered once. `ProviderNotVisibleError` is now exported.
