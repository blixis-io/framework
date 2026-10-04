---
"@blixis-io/cli": patch
---

`blix doctor` no longer reports a duplicate `@blixis-io/core` or `@blixis-io/di` when obsolete folders are left in `node_modules/.pnpm` after a dependency change. It now counts only the copies the installed packages can actually resolve, which matches `pnpm why`, instead of every physical folder.
