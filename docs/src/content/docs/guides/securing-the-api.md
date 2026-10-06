---
title: Securing the API
description: CORS, security headers, rate limiting and the client's address, with @blixis-io/security.
sidebar:
  order: 8.6
---

`@blixis-io/security` is an optional baseline of plain [middleware](/framework/concepts/middleware/) for the things a browser-facing API needs and the framework deliberately does not do on its own. Nothing is on by default; you add what you want to the `middleware` array.

```bash
npm install @blixis-io/security
```

```ts
import { createHttpApplication } from "@blixis-io/http";
import { cors, rateLimit, securityHeaders, MemoryRateLimitStore } from "@blixis-io/security";

const app = await createHttpApplication(AppModule, {
  middleware: [
    cors({ origins: ["https://app.example.com"], credentials: true }),
    securityHeaders(),
    rateLimit({ store: new MemoryRateLimitStore(), limit: 300, windowMs: 60_000 }),
  ],
});
```

## Order matters

Put `cors()` **first**, then `securityHeaders()`, then the limiters. A middleware sees every response from the ones inside it, including the `429` a limiter throws, a `404` and a `500`, so anything outside the limiter decorates those too. That is how a rejected request keeps its CORS headers (without them the browser hides the real status from your script, and the user sees "network error"). Put `requestId()` and `accessLog()` before all of them if you want every response logged with an id.

## CORS

```ts
cors({ origins: ["https://app.example.com", "http://localhost:5173"], credentials: true, exposedHeaders: ["x-request-id"] })
```

- **Explicit origins.** Exact origins only (scheme, host, port; no path, no trailing slash). `"https://app.example.com/"` is an error that tells you the right spelling. A function `(origin) => boolean` is allowed for patterns you must compute.
- **`"*"` is for public APIs.** It answers `*`. **`credentials: true` with `"*"` throws when the middleware is created**: a browser refuses it, and echoing every origin back instead would let any website make authenticated requests as your user.
- **Preflight.** `OPTIONS` with `Access-Control-Request-Method` from an allowed origin is answered `204` with the policy (methods, the headers it asked for or the list you set, `max-age`), without reaching your routes, so you need no `OPTIONS` handlers. From any other origin it is answered `204` with no CORS headers, which makes the browser refuse the real request.
- `Vary: Origin` is added whenever the answer depends on the origin, so a cache does not serve one origin's headers to another.

**CORS is a rule the browser enforces on web pages, not access control.** A request from another origin is still served; a script outside a browser ignores CORS entirely. Authorize with guards.

## Security headers

`securityHeaders()` sets conservative defaults on every response (including errors and `404`s): `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` and `Cross-Origin-Resource-Policy: same-origin`, which suit a JSON API that nothing should frame or run. Each can be changed or turned off (`frameOptions: false`). A header your route set itself is kept unless you pass `override: true`.

`Strict-Transport-Security` is **off by default**: only you know the site is HTTPS everywhere and will stay so, and browsers remember it for `maxAge` seconds. Turn it on with `hsts: { maxAge: 31_536_000, includeSubDomains: true }`; add `preload` only when you are sure.

## Rate limiting

```ts
rateLimit({ store, limit: 300, windowMs: 60_000 })                                  // everything, per client address
rateLimit({ store, name: "auth", limit: 5, windowMs: 60_000, onStoreError: "block", // sign-in and refresh, strictly
  match: (request) => new URL(request.url).pathname.startsWith("/auth/") && request.method === "POST" })
```

A fixed window per key. Every counted response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds); one over the limit is a `429` problem document with `Retry-After`.

- **What is limited** is the `key`. The default is the client's address; give `key` a function for a user id or an API key. When the address cannot be known (no socket, as under `createFetchHandler` on a platform that does not tell you), those requests share one key, `"unknown"`: pass a `key` there.
- **Several limits** can share a store: give each a `name`, and a `match` to choose the requests it counts. Sign-in and refresh deserve their own strict limit, since nothing else throttles password guessing.
- **If the store fails** the request is let through by default, so an outage of the limiter is not an outage of the API (the failure is written to the error stream). Set `onStoreError: "block"` on the sign-in limit and it answers `503` instead.

### The store decides whether the limit is real

`MemoryRateLimitStore` counts in this process's memory, which is right for development, tests and a single instance and wrong for production behind more than one: each replica counts on its own, so the real limit is the limit **times the replicas**, and a restart forgets everything. (It caps its keys, so a flood of distinct addresses cannot grow memory.) For one limit across replicas use a shared store: implement `RateLimitStore`, whose one method must add one to a key's count in the current window **atomically**. A read followed by a write is not enough; a single SQL upsert or a Redis `INCR` is.

A Postgres store, a single statement, is [`postgres-rate-limit-store.example.ts`](https://github.com/blixis-io/framework/blob/main/packages/security/src/postgres-rate-limit-store.example.ts) (copy it; it is not part of the package):

```sql
create table rate_limits (key text primary key, count integer not null, reset_at timestamptz not null);
```

It is tested against a real database: 40 simultaneous hits on one key get 40 different counts, and two application instances sharing it enforce one limit (4 of 6 requests pass, where two in-memory stores would let all 6 through). Delete rows with `reset_at < now()` from a scheduled job.

## The client's address

```ts
import { getClientIp } from "@blixis-io/security";

getClientIp(request);                                       // the address that connected
getClientIp(request, { trustedProxyHops: 1 });              // one reverse proxy in front: the last X-Forwarded-For entry
getClientIp(request, { trustedProxyHops: 1, isTrustedProxy: (peer) => peer === "10.0.0.5" });
```

Behind a proxy the address that connected is the proxy, so a limiter keyed on it would count every user together. `X-Forwarded-For` has the user's address, but a client can send it too, so it is trusted **only** as far as you say:

- `trustedProxyHops` is how many proxies **you operate** in front (a load balancer is 1; behind a CDN, 2). The address is taken that many entries from the **end** of the header, the part your own proxies wrote. The left of the header, which a client controls, is never used.
- Fewer entries than hops, or something that is not an address, falls back to the address that connected. It never guesses.
- **The server must not be reachable around the proxy**, or a client can talk to it directly and send any header. `isTrustedProxy` narrows it: the header is read only when the connecting peer is one of your proxies.
- Make sure the proxy appends to or overwrites `X-Forwarded-For` instead of passing the client's value through untouched. Many do both depending on a setting.

The address itself comes from [`currentRemoteAddress()`](/framework/guides/running-in-production/#who-is-connecting) in `@blixis-io/http`.

## What this does not do

No login lockout beyond what you configure, no bot detection, no WAF, no request-signing, no CSRF protection (a bearer-token API without cookies does not need it; if you use cookies, you do). It does not make the framework's other limits go away: `bodyLimit` and `requestTimeout` still matter. And headers and CORS are only as good as the proxy and DNS in front of them.
