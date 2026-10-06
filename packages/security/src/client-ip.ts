import { isIP } from "node:net";
import { currentRemoteAddress } from "@blixis-io/http";

export interface ClientIpOptions {
  /**
   * How many reverse proxies you operate between the internet and this server (a load balancer is one, a load
   * balancer behind a CDN is two). `0`, the default, trusts nothing: the client is whoever connected, and every
   * forwarded header is ignored. Anything else makes the client the address that many entries from the **end** of
   * `X-Forwarded-For`, which is the part your own proxies wrote. The left of the header is whatever the client sent.
   */
  trustedProxyHops?: number;
  /**
   * Only read `X-Forwarded-For` when the connecting peer is one of your proxies. Without this, a client that reaches the
   * server directly (around the proxy) can claim any address; with it, it is just itself. Recommended whenever the
   * server is reachable by anything other than the proxy.
   */
  isTrustedProxy?: (peer: string) => boolean;
}

function plain(address: string): string {
  return /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1] ?? address;
}

/**
 * The part of `getClientIp` that does not depend on being inside a request, so it can be tested on its own.
 * `forwardedFor` is the raw `X-Forwarded-For` value (several header lines arrive joined by commas).
 */
export function clientIpFrom(peer: string | undefined, forwardedFor: string | null, options: ClientIpOptions = {}): string | undefined {
  const hops = options.trustedProxyHops ?? 0;
  if (!Number.isInteger(hops) || hops < 0) {
    throw new RangeError(`trustedProxyHops must be a whole number, 0 or more (got ${hops}).`);
  }
  if (hops === 0 || forwardedFor === null || peer === undefined) {
    return peer;
  }
  if (options.isTrustedProxy && !options.isTrustedProxy(peer)) {
    return peer;
  }
  const entries = forwardedFor
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  // Fewer entries than proxies means the request did not pass through all of them: don't guess, stay with the peer.
  const candidate = entries.length >= hops ? entries[entries.length - hops] : undefined;
  return candidate !== undefined && isIP(plain(candidate)) !== 0 ? plain(candidate) : peer;
}

/**
 * The address of the user who made the request, or `undefined` when it cannot be known (no socket: an in-process call,
 * or a fetch handler on a platform that does not tell you; pass `key` to `rateLimit` for those).
 *
 * By default this is the address that connected, which behind a proxy is the proxy. Tell it how many proxies you run
 * with `trustedProxyHops` and it reads the user's address from `X-Forwarded-For`, counting from the end so that the
 * part of the header a client can forge is never used. Make sure the proxy appends to (or overwrites) that header and
 * that the server cannot be reached around the proxy; see `isTrustedProxy`.
 */
export function getClientIp(request: Request, options: ClientIpOptions = {}): string | undefined {
  return clientIpFrom(currentRemoteAddress(), request.headers.get("x-forwarded-for"), options);
}
