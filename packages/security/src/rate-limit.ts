import { HttpException, withResponseHeaders, type Middleware } from "@blixis-io/http";
import { getClientIp, type ClientIpOptions } from "./client-ip.js";

/** One hit counted against a key. */
export interface RateLimitHit {
  /** Hits in the current window, including this one. */
  count: number;
  /** When the current window ends, in epoch milliseconds. */
  resetAt: number;
}

/**
 * Where the counts live. `hit` must add one to `key`'s count in the current fixed window of `windowMs` (starting a new
 * window if the last one has ended) and return the result, **atomically**: two replicas calling it at once must never
 * both see the same count. A single SQL upsert or a Redis `INCR` does that; a read followed by a write does not.
 */
export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
}

export interface RateLimitOptions {
  store: RateLimitStore;
  /** Requests allowed per window per key. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * Prefix that keeps this limit's counts apart from another `rateLimit` sharing the store (a strict one for sign-in, a
   * loose one for everything). Default `"default"`.
   */
  name?: string;
  /**
   * What is being limited: a user id, an API key, an IP. Default: the client address (`getClientIp` with `clientIp`).
   * When it returns `undefined` (the address cannot be known) the request is counted under one shared key, `"unknown"`,
   * which fails closed but makes every such caller share a budget: give platforms that don't tell you the address a `key`.
   */
  key?: (request: Request) => string | undefined | Promise<string | undefined>;
  /** How to find the client address for the default `key`. Behind a proxy, set `trustedProxyHops`. */
  clientIp?: ClientIpOptions;
  /** Only requests this returns `true` for are counted (for example just the sign-in and refresh routes). Default: all. */
  match?: (request: Request) => boolean;
  /** The `detail` of the `429`. */
  message?: string;
  /**
   * If the store throws (the database is down): `"allow"` (default) lets the request through so an outage of the limiter
   * does not become an outage of the API, `"block"` answers `503` instead, which is what a sign-in route should do.
   */
  onStoreError?: "allow" | "block";
}

/**
 * A fixed-window rate limit with a pluggable store. Every counted response carries `RateLimit-Limit`,
 * `RateLimit-Remaining` and `RateLimit-Reset` (seconds); one over the limit is a `429` problem document with
 * `Retry-After`. Put it **after** `cors()` and `securityHeaders()` so the `429` carries their headers too.
 *
 * Counts are per store. The in-memory store is per process: with several replicas each enforces the limit on its own,
 * so the real limit is the limit times the replicas. Use a shared store for one limit across them.
 */
export function rateLimit(options: RateLimitOptions): Middleware {
  const { store, limit, windowMs } = options;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`rateLimit(): limit must be a whole number, 1 or more (got ${limit}).`);
  }
  if (!Number.isInteger(windowMs) || windowMs < 1) {
    throw new RangeError(`rateLimit(): windowMs must be a whole number of milliseconds, 1 or more (got ${windowMs}).`);
  }
  const name = options.name ?? "default";
  const message = options.message ?? "Too many requests";
  const keyOf = options.key ?? ((request: Request) => getClientIp(request, options.clientIp));

  return async (request, next) => {
    if (options.match && !options.match(request)) {
      return next();
    }

    const key = `${name}:${(await keyOf(request)) ?? "unknown"}`;
    let hit: RateLimitHit;
    try {
      hit = await store.hit(key, windowMs);
    } catch (error) {
      console.error("[@blixis-io/security] the rate-limit store failed:", error);
      if (options.onStoreError === "block") {
        throw new HttpException(503, "Rate limiting is unavailable");
      }
      return next();
    }

    const resetSeconds = Math.max(0, Math.ceil((hit.resetAt - Date.now()) / 1000));
    const headers = {
      "ratelimit-limit": String(limit),
      "ratelimit-remaining": String(Math.max(0, limit - hit.count)),
      "ratelimit-reset": String(resetSeconds),
    };
    if (hit.count > limit) {
      throw new HttpException(429, message, undefined, { ...headers, "retry-after": String(Math.max(1, resetSeconds)) });
    }
    return withResponseHeaders(await next(), headers);
  };
}
