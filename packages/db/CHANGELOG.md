# @blixis-io/db

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
