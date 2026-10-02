---
"@blixis-io/cli": minor
---

Add `blix doctor`: checks decorator flags in `tsconfig.json`, duplicate copies of `@blixis-io/core`/`di`, the Node version, the `packageManager` pin, and tooling that drops decorator metadata (`tsx`, `esbuild`, Vitest without Oxc settings). Exits `1` on failures.
