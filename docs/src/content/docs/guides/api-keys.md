---
title: API keys for machines
description: Create, use, scope, rotate and revoke API keys for services and scripts, where 2FA and IP limits fit, what to log, and what is tested and what is not.
sidebar:
  order: 8.65
---

A person signs in and gets a short-lived token. A **service, a script or a partner** needs something that does not expire in 15 minutes and that you can turn off on its own: an API key. This page is how to run them. The mechanics (every option, every status code) are in the [`@blixis-io/auth` reference](/framework/reference/blixis-auth/#api-keys); `examples/saas-api` does all of it, with tests.

## What you get, and what you do not

| | |
| --- | --- |
| **Identity** | A key resolves to the **same claims** as a token, so `@Roles`, `getCurrentUser` and [tenancy](/framework/concepts/tenancy/) work unchanged. |
| **Storage** | Only a SHA-256 of the secret. A leaked database does not leak keys (and the secret is 256 random bits, so there is nothing to guess). |
| **Limits** | An optional expiry, instant revocation, scopes, and optional networks (`allowedCidrs`). |
| **Failure** | Every bad key is the **same** `401`. A broken store is a `503`, never an allow. |
| **Not included** | 2FA (it does not apply to a machine), mTLS, request signing (HMAC), OAuth client credentials. Those are different mechanisms; none is planned until someone needs it. |

## 1. Set it up

You write the store (a table and a class), because only you know where keys live. A Postgres one to copy is `packages/auth/src/postgres-api-key-store.example.ts`; the reference app's is `examples/saas-api/src/api-keys/api-key.store.ts`.

```ts
AuthModule.forRoot({
  secret: process.env.JWT_SECRET!,
  protectAllRoutes: true,
  apiKeys: {
    store: DrizzleApiKeyStore,
    scopedRoutesOnly: true,                      // see "Scopes"; turn it on
    clientIp: { trustedProxyHops: 1 },           // see "Limiting by network"
  },
});
```

`@UseGuards(JwtAuthGuard)` accepts **tokens only**, on purpose. Routes that should accept keys go through `AuthGuard`, which `protectAllRoutes` applies everywhere.

## 2. Create a key

```ts
const { id, key, secretHash } = generateApiKey();
// store `id` and `secretHash` (plus who it is for, its scopes, expiry, networks) and show `key` to its owner, once
```

`key` looks like `blx_<24 hex>_<43 characters>`. **Show it once** and say so: after this response nothing in your system can show it again, which is the point. If an owner loses it, they make a new one.

Let people with the right to do it (the reference app: a space's owners) create keys through a route, and let **no key do it**. In `saas-api`, key management carries no `@RequireScopes`, so `scopedRoutesOnly` refuses keys there, and the controller checks as well, so the rule survives someone changing the option.

## 3. Use it

```bash
curl https://api.example.com/spaces/$SPACE/projects -H "x-api-key: $KEY"
```

- **Header, never the URL.** A key in a query string ends up in browser history, proxy logs and referrers. The framework's access log records the path only (the query is left out), but your proxy's may not.
- When `x-api-key` is present it **is** the credential: a bad key is a `401`, and a valid `Authorization` header sent alongside does not rescue it. Without `apiKeys` configured the header is ignored.

## 4. Scopes: give a key less than a person has

```ts
@Controller("spaces/:spaceId/projects")
@RequireScopes("projects:read")
class ProjectsController {
  @Post()
  @RequireScopes("projects:write")   // replaces the controller's
  create() {}
}
```

A key must hold **all** the scopes a route lists, or it gets a `403`. Scopes limit **keys only**; a person's permissions come from roles and membership. With `scopedRoutesOnly: true` a key is also refused on any route **without** `@RequireScopes`, so a forgotten annotation closes a route to keys instead of opening it. Give a key the fewest scopes the job needs.

Make a key **belong to one tenant**: in `saas-api` the key's claims carry its `spaceId`, and the tenancy guard answers `404` for any other space, so a key cannot read across tenants even with every scope.

## 5. Rotate without downtime

Keys do not expire unless you set `expiresAt`, so rotation is a habit, not an event. With two keys valid at once there is no gap:

1. Create a **second** key for the same client (same scopes, networks).
2. The client switches to it and confirms it works.
3. **Revoke the first.** It stops working immediately.
4. Check the first key's last-used time before you do step 3: a key that is still being used is a client you have not moved yet.

Setting an expiry (`expiresInDays` in the reference app) at creation is the cheap way to make rotation happen. The reference app's test `two keys for one job are both valid until the old one is revoked` runs exactly this.

## 6. Revoke, and how fast it is

Revoking sets `revokedAt`; the row stays for the audit trail. Without the cache, the next request is refused. With `cacheSeconds` set, **a revocation can take up to that many seconds to reach a process that has the old record**: a number you chose, and it is the price of one fewer query per request. Leave it at `0` unless a measurement says otherwise. If you must cut a key off now with the cache on, restart or roll the processes, or lower `cacheSeconds` first.

**If a key leaks** (it is in a public repository, a log, a ticket): revoke it first, then look at its last-used time and your access log by key id to see what it did, then issue a replacement. Revoking first is the rule; investigating a key that still works is not.

## 7. What to log

- **Log the key's id, never the key.** `getCurrentApiKey(ctx)` gives `{ id, scopes }`. The id is not a secret and is what you search by when a key misbehaves.
- The framework's `accessLog` records method, path, status and duration: **no headers**, so no key. Check that **your** logging does not add them: your `onError` hook receives the `request`, and a logger that dumps request headers will write the key. `saas-api` has a test that fails if the key or its secret appears anywhere in the captured logs.
- Never put a key in an error message, a metric label or a trace attribute.
- Teach your secret scanner the format (`blx_` followed by 24 hex characters, an underscore and 43 characters), if it supports custom patterns, so a committed key is found by you before someone else finds it.

## 8. Limiting by network

`allowedCidrs` (for example `["203.0.113.0/24", "2001:db8::/32"]`) refuses a key from anywhere else. It is **only as good as the address your server believes**:

- Behind a proxy every client looks like the proxy until you set `clientIp: { trustedProxyHops: n }` ([how](/framework/guides/securing-the-api/#the-clients-address)). Set `isTrustedProxy: createIpMatcher([...your proxies...])` too, so a client that reaches the server around the proxy cannot send its own `X-Forwarded-For`.
- **The server must not be reachable around the proxy**, or the header means nothing. Set this at the network, not in code.
- A key with `allowedCidrs` is refused when the address **cannot be known** (an in-process call, a platform that does not pass it). It fails closed.
- IPv4-mapped IPv6 addresses (`::ffff:203.0.113.7`) are read as the IPv4 address. A network written with host bits (`192.168.1.5/24`) is refused when the key is created, and the message says the network you probably meant.
- A network allowlist narrows what a stolen key is worth; it is a second lock, not a replacement for revocation. Mobile and home networks change addresses, so use it for servers.

The reference app validates networks when a key is created (a typo is a `400`, not a key that silently matches nothing).

## 9. Rate limit per key, after verification

A limiter in front of authentication cannot be keyed on the key in the header: anyone can send **someone else's key id with a wrong secret** and use up that key's allowance. Count after the guard, when the id is a verified one:

```ts
// examples/saas-api/src/api-keys/key-rate-limit.guard.ts
const hit = await store.hit(`api-key:${getCurrentApiKey(ctx).id}`, 60_000);
if (hit.count > limit) throw new HttpException(429, "Too Many Requests", undefined, { "retry-after": "…" });
```

Keep the per-address limiter in front for everything that is not yet a key (unknown ids included: this package does not rate limit those).

## 10. What each answer means

| Status | When |
| --- | --- |
| `401` `Invalid API key` | Malformed, unknown id, wrong secret, revoked, expired, outside `allowedCidrs`, or stored claims that fail your schema. Always the same body: a response never says which. |
| `403` | A valid key without the scope a route needs, or on a route that declares none under `scopedRoutesOnly`. |
| `404` | A valid key asking for another tenant's data (the tenancy rule). |
| `429` | A key over its own limit. |
| `503` | The store failed, or a stored network is malformed. The request is **not** let through. |

## What is tested, and what is not

Tested against a real Postgres, through the real application (`examples/saas-api`, 26 end-to-end tests) and in the package (unit with a fake clock and store, real sockets for the address rules, a real Postgres store, parser fuzzing): every row of the table above, the one-space confinement, revocation, expiry and rotation, `scopedRoutesOnly`, the per-key limit, the key never appearing in a list, the database row or the logs. Each guarantee was checked by removing the line that provides it and watching a test fail.

Not tested: a real proxy or CDN in front, the per-key limit across several server processes (the counters are in Postgres so they should hold; it was not run with two), and that an unknown id costs the same time as a wrong secret (it is constant by construction, not measured).
