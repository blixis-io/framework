---
"@blixis-io/di": patch
"@blixis-io/core": patch
---

Loading two copies of `@blixis-io/di` or `@blixis-io/core` into one process now fails at import with a `DuplicatePackageError` that names both copies (version and location) and the fix. Before, a version skew (for example upgrading `@blixis-io/http` without `@blixis-io/core`) installed two copies with separate DI metadata and failed much later with a misleading `NotAModuleError: ... did you forget @Module()?`. The check only catches a duplicate when both copies include it. Exports `assertSingleInstance`, `DuplicatePackageError` and `packageVersion` from `@blixis-io/di` for other packages to reuse.
