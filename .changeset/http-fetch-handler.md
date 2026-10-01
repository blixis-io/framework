---
"@blixis-io/http": minor
---

New `createFetchHandler(AppModule, options?)` for platforms that call `fetch(request)` per request (Vercel, Netlify, Cloudflare Workers): `export default createFetchHandler(AppModule)`. It boots the app lazily on the first request and shares that boot between concurrent requests. A failed boot answers a generic 500 (the error is logged, never sent to the client) and is retried on the next request instead of being cached. Checked running in the local Workers runtime.
