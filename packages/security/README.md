# `@blixis-io/security`

> **Not published yet:** private until its npm placeholder and trusted publisher exist.

An optional production baseline for [`@blixis-io/http`](../http): CORS with explicit origins, security headers, rate limiting with a pluggable shared store, and a proxy-aware client address. Plain middleware; nothing is on by default.

```bash
npm install @blixis-io/security @blixis-io/http
```

```ts
import { createHttpApplication } from "@blixis-io/http";
import { cors, MemoryRateLimitStore, rateLimit, securityHeaders } from "@blixis-io/security";

const app = await createHttpApplication(AppModule, {
  middleware: [
    cors({ origins: ["https://app.example.com"], credentials: true }),
    securityHeaders(),
    rateLimit({ store: new MemoryRateLimitStore(), limit: 300, windowMs: 60_000 }),
  ],
});
```

`cors` first, so even a `429` carries its headers. `credentials: true` with `"*"` is refused when the middleware is created. The in-memory store is per process: behind several replicas use a shared store (a Postgres one is in the docs).

Part of [Blixis Framework](https://github.com/blixis-io/framework) — full docs: [Securing the API](https://blixis-io.github.io/framework/guides/securing-the-api/) · [API reference](https://blixis-io.github.io/framework/reference/blixis-security/).
