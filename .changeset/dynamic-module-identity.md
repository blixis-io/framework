---
"@blixis-io/core": minor
---

Registering one module class through two different dynamic configurations (e.g. two `DatabaseModule.forRoot(...)` calls) now throws `DuplicateDynamicModuleError` at boot instead of silently keeping the first. Reusing the same registration object across several imports still dedupes. `ProviderNotVisibleError` is now exported.
