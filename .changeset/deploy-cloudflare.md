---
"@blixis-io/deploy": minor
---

Cloudflare Workers target. `blix deploy init --target cloudflare` writes `cloudflare/worker.mjs` (`export default createFetchHandler(AppModule)` over your compiled app) and a `wrangler.toml` with `nodejs_compat`, the Worker name derived from your package name; `blix deploy` then runs your build script and `npx wrangler deploy` (`environment` and `config` options). No bundler is added: Wrangler's own esbuild only ever sees compiled JavaScript, so the decorator metadata `tsc` emitted survives. CI files pass `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Needs `@blixis-io/http` 0.3+ and, until released, the `di`/`core` fix that stops the duplicate-copy guard crashing in Workers.
