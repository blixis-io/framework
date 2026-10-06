# @blixis-io/logging

## 0.3.1

### Patch Changes

- Updated dependencies [[`d8ba3d1`](https://github.com/blixis-io/framework/commit/d8ba3d1a99f38ef0b7a792912585c75dc4cc42d0)]:
  - @blixis-io/core@0.5.0

## 0.3.0

### Minor Changes

- [#92](https://github.com/blixis-io/framework/pull/92) [`c618f86`](https://github.com/blixis-io/framework/commit/c618f862d5e1e38c1c14380e26e021fac322d12f) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Three logging fixes, one of them a new option.
  
  **Errors are no longer lost.** The console transport wrote the context with `JSON.stringify`, which turns an `Error` into `{}`: `log.error("failed", { err })` printed `{"err":{}}` (or just `{"code":"ECONNREFUSED"}` when the error carried a property), with no message and no stack. It now writes the error's name, message, stack, cause chain and own properties. If you parsed the old output, note that an error in the context now appears as an object with those fields.
  
  **A log line is never dropped for what it contains.** A circular object or a `BigInt` made `JSON.stringify` throw; the logger caught it and wrote only `[@blixis-io/logging] a transport failed`, losing the entry. They are now written (`"[Circular]"`, the BigInt as text), as are functions, symbols, `Map` and `Set`, and a getter that throws. New exports `safeStringify` and `toJsonSafe` let your own transports do the same.
  
  **New `redact` option** on `createLogger` and `LoggerModule.forRoot`: a list of key names whose values never reach a transport (`"[REDACTED]"`, at any depth, by whole name, ignoring case). `COMMON_SECRET_KEYS` is a starting list. Opt-in: nothing changes unless you pass it. With it set, a transport receives each context as plain data, so an attached `Error` arrives as an object rather than an `Error` instance. It covers the context only, not the message string.
  
  **Disabled levels cost almost nothing.** The logger merged the bound and per-call contexts before checking whether anyone would receive the entry, so a `debug` call below the level still copied them: about 98 ns per call with a small context, 9 ns now (measured on the built package, 2 million calls; indicative, not a benchmark suite).

## 0.2.0

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

## 0.1.4

### Patch Changes

- Updated dependencies [[`3b2d859`](https://github.com/blixis-io/framework/commit/3b2d85957cba17f6cfc6273f327c042b25d7ca36)]:
  - @blixis-io/di@0.1.2
  - @blixis-io/core@0.3.1

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
