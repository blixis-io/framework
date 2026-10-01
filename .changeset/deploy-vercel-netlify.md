---
"@blixis-io/deploy": minor
---

Vercel and Netlify targets. `blix deploy init --target vercel|netlify` writes the function entry (`createFetchHandler`, needs `@blixis-io/http` 0.3+), the provider's config and a `public/` directory; `blix deploy` then runs your build script and the provider CLI through `npx`. The entry imports your `tsc` output so the providers' esbuild never sees decorators. Also: `init --name` to name a target, a printed snippet instead of an edit when `blix.config.*` already exists, `--app-module`/`--app-export`, and `doctor` checks `npx` and lists each provider's credentials. `init`, CI generation and `doctor` now go through the target adapter.
