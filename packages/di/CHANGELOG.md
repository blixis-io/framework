# @blixis-io/di

## 0.1.2

### Patch Changes

- [#55](https://github.com/blixis-io/framework/pull/55) [`3b2d859`](https://github.com/blixis-io/framework/commit/3b2d85957cba17f6cfc6273f327c042b25d7ca36) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Fix a crash at import when an app is bundled into a single file or run on Cloudflare Workers. The duplicate-copy guard added in `di` 0.1.1 / `core` 0.2.1 read its own `package.json` through `createRequire(import.meta.url)`; in a bundle there is no `package.json` beside the code (`Cannot find module '../package.json'`), and Workers give modules no URL at all (`The argument 'path' ... Received 'undefined'`). The guard now does nothing without a module URL, reports the version as "unknown" when it can't read it, and can no longer throw for any reason other than a real duplicate copy. Apps that keep `node_modules` as files (Docker, Vercel, Netlify, plain Node) were never affected.

## 0.1.1

### Patch Changes

- [#42](https://github.com/blixis-io/framework/pull/42) [`fe1f67a`](https://github.com/blixis-io/framework/commit/fe1f67af5657af8d0d2a1ba8ca0aef400617d597) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Loading two copies of `@blixis-io/di` or `@blixis-io/core` into one process now fails at import with a `DuplicatePackageError` that names both copies (version and location) and the fix. Before, a version skew (for example upgrading `@blixis-io/http` without `@blixis-io/core`) installed two copies with separate DI metadata and failed much later with a misleading `NotAModuleError: ... did you forget @Module()?`. The check only catches a duplicate when both copies include it. Exports `assertSingleInstance`, `DuplicatePackageError` and `packageVersion` from `@blixis-io/di` for other packages to reuse.
