# @blixis-io/db

## 0.4.1

### Patch Changes

- Updated dependencies [[`d8ba3d1`](https://github.com/blixis-io/framework/commit/d8ba3d1a99f38ef0b7a792912585c75dc4cc42d0)]:
  - @blixis-io/core@0.5.0

## 0.4.0

### Minor Changes

- [#79](https://github.com/blixis-io/framework/pull/79) [`08497a6`](https://github.com/blixis-io/framework/commit/08497a6e65855883d5ff873bd4266064e7c642f6) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - An idle Postgres connection that dies (database restart or failover, a network drop, an administrator ending the session) no longer crashes the process. `pg` re-emits that error on the pool, and with no listener Node threw it as an unhandled `error` event. `DrizzleModule.forRoot()` now always listens: the error goes to the new `onPoolError(error)` option, default `console.error`, and the pool opens a replacement connection on the next query.
  
  New default: a request for a connection now fails after 10 seconds (`connectionTimeoutMillis`) instead of waiting forever when the pool is exhausted or the database is unreachable. Set `connectionTimeoutMillis` yourself to change it, or `0` for the old behaviour of no limit. Apps with a database that can take longer than 10 seconds to accept a connection (a serverless database waking from idle, for example) should raise it.

### Patch Changes

- Updated dependencies [[`c1e01e9`](https://github.com/blixis-io/framework/commit/c1e01e9aaa798482663417799904f4d36f27056b)]:
  - @blixis-io/core@0.4.1
  - @blixis-io/di@0.1.3

## 0.3.0

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

### Patch Changes

- Updated dependencies [[`9746012`](https://github.com/blixis-io/framework/commit/9746012b8513e6039a27978946ea4d07abb65f69)]:
  - @blixis-io/core@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`3b2d859`](https://github.com/blixis-io/framework/commit/3b2d85957cba17f6cfc6273f327c042b25d7ca36)]:
  - @blixis-io/di@0.1.2
  - @blixis-io/core@0.3.1

## 0.2.0

### Minor Changes

- [#50](https://github.com/blixis-io/framework/pull/50) [`b9a8b82`](https://github.com/blixis-io/framework/commit/b9a8b8233063438418221c03d7bd23944e9e225b) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - New `@Transactional()` method decorator. The method runs in a database transaction: it commits when it resolves and rolls back when it throws, and calls to other `@Transactional` methods sharing the database join the outer transaction. No `tx` has to be passed around: the injected `DATABASE` is now a thin wrapper that sends each query to the current transaction (tracked per call chain with `AsyncLocalStorage`) and to the pool otherwise, so existing `this.db...` code is unchanged. The compiler rejects a method that doesn't return a promise; a missing or ambiguous database is a `TransactionalError`. Accepts Drizzle's transaction options (`isolationLevel`, `accessMode`, `deferrable`) and a `database` option for when the DATABASE isn't a direct property of the class.

## 0.1.3

### Patch Changes

- Updated dependencies [[`4c34195`](https://github.com/blixis-io/framework/commit/4c34195a621dabc5d2f31e7a4eeed54a2dbc6d45)]:
  - @blixis-io/core@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [[`fe1f67a`](https://github.com/blixis-io/framework/commit/fe1f67af5657af8d0d2a1ba8ca0aef400617d597)]:
  - @blixis-io/di@0.1.1
  - @blixis-io/core@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [[`cbc09de`](https://github.com/blixis-io/framework/commit/cbc09de1c8b2fa16d183f2d3b95d0e922c44e7e7)]:
  - @blixis-io/core@0.2.0
