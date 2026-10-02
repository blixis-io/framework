---
"@blixis-io/deploy": patch
---

Read `app.module` and `app.export` from existing `blix.config` when generating Vercel, Netlify and Cloudflare entries with `blix deploy init`. Explicit app flags override each config value, and missing fields retain the conventional defaults. Reject invalid app settings before writing provider files.
