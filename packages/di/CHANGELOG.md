# @blixis-io/di

## 0.1.1

### Patch Changes

- [#42](https://github.com/blixis-io/framework/pull/42) [`fe1f67a`](https://github.com/blixis-io/framework/commit/fe1f67af5657af8d0d2a1ba8ca0aef400617d597) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Loading two copies of `@blixis-io/di` or `@blixis-io/core` into one process now fails at import with a `DuplicatePackageError` that names both copies (version and location) and the fix. Before, a version skew (for example upgrading `@blixis-io/http` without `@blixis-io/core`) installed two copies with separate DI metadata and failed much later with a misleading `NotAModuleError: ... did you forget @Module()?`. The check only catches a duplicate when both copies include it. Exports `assertSingleInstance`, `DuplicatePackageError` and `packageVersion` from `@blixis-io/di` for other packages to reuse.
