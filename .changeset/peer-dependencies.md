---
"@blixis-io/auth": minor
"@blixis-io/config": minor
"@blixis-io/core": minor
"@blixis-io/db": minor
"@blixis-io/events": minor
"@blixis-io/http": minor
"@blixis-io/logging": minor
"@blixis-io/openapi": minor
"@blixis-io/tenancy": minor
"@blixis-io/testing": minor
"create-blixis": patch
---

`@blixis-io/core`, `@blixis-io/di`, `@blixis-io/http`, `zod` and `drizzle-orm` are now **peer dependencies** of the packages that build on them, instead of exact-version dependencies. Before, the libraries pinned exact versions (for example `auth` required `core 0.3.1`), so upgrading `core` by a patch left every library on its own older copy and the app ended up with two. Now your project installs each once and every package shares it; a version that doesn't fit is reported by the package manager at install time.

**What you need to do:** make sure your project depends on what the packages you use build on. pnpm and npm 7+ install missing peers automatically; with yarn or bun, or to be explicit, add them. Per package:

- `core`: `di`
- `http`: `core`, `di`, `zod`
- `auth`, `tenancy`, `testing`: `http` (and so `core`, `di`, `zod`); `tenancy` also `drizzle-orm`
- `openapi`: `http`, `di`, `zod`
- `config`: `core`, `di`, `zod`
- `events`, `logging`: `core`, `di`
- `db`: `core`, `di`, `drizzle-orm` (`pg` is still installed for you)

`create-blixis` now installs `zod`, which `@blixis-io/http` needs. See Installation in the docs for the full table.
