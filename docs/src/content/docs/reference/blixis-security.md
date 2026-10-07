---
title: "@blixis-io/security"
description: Full API reference for the security package.
sidebar:
  order: 17
---

Optional production middleware for `@blixis-io/http`: CORS, security headers, rate limiting and a proxy-aware client address. See [Securing the API](/framework/guides/securing-the-api/) for how to use it. Peer dependency: `@blixis-io/http`.

## `cors`

```ts
function cors(options: CorsOptions): Middleware;

interface CorsOptions {
  origins: readonly string[] | "*" | ((origin: string) => boolean);
  methods?: readonly string[]; // default GET, HEAD, PUT, PATCH, POST, DELETE
  allowedHeaders?: readonly string[]; // default: what the preflight asks for
  exposedHeaders?: readonly string[];
  credentials?: boolean; // default false; never with "*"
  maxAge?: number; // seconds, default 600
}
```

Throws `SecurityConfigError` when created for `credentials` with `"*"`, an origin that is not exact, or a bad `maxAge`.

## `securityHeaders`

```ts
function securityHeaders(options?: SecurityHeadersOptions): Middleware;

interface SecurityHeadersOptions {
  contentTypeOptions?: string | false; // default "nosniff"
  referrerPolicy?: string | false; // default "no-referrer"
  frameOptions?: string | false; // default "DENY"
  contentSecurityPolicy?: string | false; // default "default-src 'none'; frame-ancestors 'none'"
  crossOriginResourcePolicy?: string | false; // default "same-origin"
  hsts?: { maxAge: number; includeSubDomains?: boolean; preload?: boolean } | false; // default off
  override?: boolean; // replace a header the route set; default false
}
```

## `rateLimit`

```ts
function rateLimit(options: RateLimitOptions): Middleware;

interface RateLimitOptions {
  store: RateLimitStore;
  limit: number; // per window per key
  windowMs: number;
  name?: string; // default "default": prefixes the key, to share a store between limits
  key?: (request: Request) => string | undefined | Promise<string | undefined>; // default: the client address
  clientIp?: ClientIpOptions;
  match?: (request: Request) => boolean; // default: every request
  message?: string; // the 429's detail, default "Too many requests"
  onStoreError?: "allow" | "block"; // default "allow"; "block" answers 503
}

interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<RateLimitHit>; // add one in the current window, atomically
}

interface RateLimitHit {
  count: number; // including this hit
  resetAt: number; // epoch milliseconds
}
```

Counted responses carry `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; a `429` adds `Retry-After`. A `limit` or `windowMs` that is not a positive whole number throws `RangeError` when created.

### `MemoryRateLimitStore`

```ts
class MemoryRateLimitStore implements RateLimitStore {
  constructor(options?: MemoryRateLimitStoreOptions); // { maxKeys?: number; now?: () => number }, maxKeys default 100 000
}
```

In-process: not shared across replicas. Past `maxKeys` it drops ended windows and then the oldest keys.

## `getClientIp`

```ts
function getClientIp(request: Request, options?: ClientIpOptions): string | undefined;

interface ClientIpOptions {
  trustedProxyHops?: number; // default 0: trust no header
  isTrustedProxy?: (peer: string) => boolean;
}
```

The address that connected, or with `trustedProxyHops` the address that many entries from the end of `X-Forwarded-For`. `undefined` when there is no socket. `clientIpFrom(peer, forwardedFor, options)` is the same logic as a pure function. Throws `RangeError` for `trustedProxyHops` that is not a whole number, 0 or more.

## `createIpMatcher`, `ipInCidrs`, `parseCidr`

```ts
function createIpMatcher(networks: readonly (string | Cidr)[]): (ip: string | undefined) => boolean;
function ipInCidrs(ip: string | undefined, networks: readonly (string | Cidr)[]): boolean; // parses on every call
function parseCidr(text: string): Cidr; // { family: 4 | 6; prefix: number; network: bigint }
```

Whether an address is inside any of a list of networks (`"10.0.0.0/8"`, `"2001:db8::/32"`, or a bare address for one host). Build a matcher **once** at startup; it fits `isTrustedProxy` directly.

- A network that is malformed throws `SecurityConfigError` when the matcher is built. Refused: a prefix that is not plain digits or is out of range, any zone id (`%eth0`), spaces, leading zeros, hex or single-number addresses (`0x7f.0.0.1`, `2130706433`), and an address with **bits set after the prefix** (`192.168.1.5/24`: the message says which network was probably meant, `192.168.1.0/24`).
- An address that is not a valid IP (or is `undefined`) is **never inside**, whatever the list holds, and never throws.
- An IPv4-mapped IPv6 address (`::ffff:10.0.0.1`, what a dual-stack socket reports) is matched as the IPv4 address it carries, and `::ffff:10.0.0.0/104` as the IPv4 network `10.0.0.0/8`. IPv4 and IPv6 networks never match each other's addresses: `::/0` is every real IPv6 address and no IPv4 one.

Checked against a bit-string model with property tests (every prefix length, both families, several spellings of the same IPv6 address), and against hostile strings; not checked against other libraries' behaviour.

## `SecurityConfigError`

Thrown at creation for configuration that cannot work securely.
