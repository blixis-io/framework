# @blixis-io/core

## 0.5.0

### Minor Changes

- [#125](https://github.com/blixis-io/framework/pull/125) [`d8ba3d1`](https://github.com/blixis-io/framework/commit/d8ba3d1a99f38ef0b7a792912585c75dc4cc42d0) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - New `onRollbackError` option on `createApplication`: called for each `onApplicationShutdown` hook that fails while a failed boot is being rolled back. The boot's own error is still what `createApplication` rejects with. Without the option the failure is written with `console.error`, as before; a hook that throws is caught and both failures are written.

## 0.4.1

### Patch Changes

- [#81](https://github.com/blixis-io/framework/pull/81) [`c1e01e9`](https://github.com/blixis-io/framework/commit/c1e01e9aaa798482663417799904f4d36f27056b) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Two lifecycle failures no longer leak resources.
  
  `app.close()` now runs **every** shutdown hook even when one throws. Before, the first failure aborted the rest, so a failing flush could leave the database pool open. One failure is rethrown as it is; several are rethrown together as an `AggregateError`.
  
  A boot that fails part-way (a constructor, `onModuleInit` or `onApplicationBootstrap` throws) now shuts down the providers it had already built, dependents first, then rejects with the original error. Before, nothing was closed: a connection pool opened by an earlier provider kept the process alive for its idle timeout (10 seconds for `pg`), and `createFetchHandler` leaked one per failed boot attempt. A failure in a shutdown hook during that clean-up is logged with `console.error` and does not replace the boot error.
  
  `@blixis-io/di`: `Container.resolveAll()` now waits for every in-flight resolution to settle before rejecting with the first failure, so providers still being built when one fails can be cleaned up.
- Updated dependencies [[`c1e01e9`](https://github.com/blixis-io/framework/commit/c1e01e9aaa798482663417799904f4d36f27056b)]:
  - @blixis-io/di@0.1.3

## 0.4.0

### Minor Changes

- [#76](https://github.com/blixis-io/framework/pull/76) [`9746012`](https://github.com/blixis-io/framework/commit/9746012b8513e6039a27978946ea4d07abb65f69) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - `@blixis-io/core`, `@blixis-io/di`, `@blixis-io/http`, `zod` and `drizzle-orm` are now **peer dependencies** of the packages that build on them, instead of exact-version dependencies. Before, the libraries pinned exact versions (for example `auth` required `core 0.3.1`), so upgrading `core` by a patch left every library on its own older copy and the app ended up with two. Now your project installs each once and every package shares it; a version that doesn't fit is reported by the package manager at install time.
  
  **What you need to do:** make sure your project depends on what the packages you use build on. pnpm and npm 7+ install missing peers automatically; with yarn or bun, or to be explicit, add them. Per package:
  
  - `core`: `di`
  - `http`: `core`, `di`, `zod`
  - `auth`, `tenancy`, `testing`: `http` (and so `core`, `di`, `zod`); `tenancy` also `drizzle-orm`
  - `openapi`: `http`, `di`, `zod`
  - `config`: `core`, `di`, `zod`
  - `events`, `logging`: `core`, `di`
  - `db`: `core`, `di`, `drizzle-orm` (`pg` is still installed for you)
  
  `create-blixis` now installs `zod`, which `@blixis-io/http` needs. See Installation in the docs for the full table.

## 0.3.1

### Patch Changes

- [#55](https://github.com/blixis-io/framework/pull/55) [`3b2d859`](https://github.com/blixis-io/framework/commit/3b2d85957cba17f6cfc6273f327c042b25d7ca36) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Fix a crash at import when an app is bundled into a single file or run on Cloudflare Workers. The duplicate-copy guard added in `di` 0.1.1 / `core` 0.2.1 read its own `package.json` through `createRequire(import.meta.url)`; in a bundle there is no `package.json` beside the code (`Cannot find module '../package.json'`), and Workers give modules no URL at all (`The argument 'path' ... Received 'undefined'`). The guard now does nothing without a module URL, reports the version as "unknown" when it can't read it, and can no longer throw for any reason other than a real duplicate copy. Apps that keep `node_modules` as files (Docker, Vercel, Netlify, plain Node) were never affected.
- Updated dependencies [[`3b2d859`](https://github.com/blixis-io/framework/commit/3b2d85957cba17f6cfc6273f327c042b25d7ca36)]:
  - @blixis-io/di@0.1.2

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
