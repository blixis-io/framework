---
"@blixis-io/di": patch
"@blixis-io/core": patch
---

Fix a crash at import when an app is bundled into a single file or run on Cloudflare Workers. The duplicate-copy guard added in `di` 0.1.1 / `core` 0.2.1 read its own `package.json` through `createRequire(import.meta.url)`; in a bundle there is no `package.json` beside the code (`Cannot find module '../package.json'`), and Workers give modules no URL at all (`The argument 'path' ... Received 'undefined'`). The guard now does nothing without a module URL, reports the version as "unknown" when it can't read it, and can no longer throw for any reason other than a real duplicate copy. Apps that keep `node_modules` as files (Docker, Vercel, Netlify, plain Node) were never affected.
