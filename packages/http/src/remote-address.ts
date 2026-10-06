import { RequestContext } from "./request-context.js";

/** The `RequestContext` key the address of the connecting peer is stored under, for the whole request. */
export const REMOTE_ADDRESS_KEY = "blixis.http.remote-address";

const context = new RequestContext();

/** Who opened the connection each request arrived on, recorded by the Node adapter when it builds the `Request`. */
const peers = new WeakMap<Request, string>();

/** `::ffff:203.0.113.7` is how a dual-stack socket reports an IPv4 peer; the plain form is what everything else (logs, rate-limit keys, allow lists) uses. */
export function normalizeAddress(address: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  return mapped?.[1] ?? address;
}

/** Called by the Node adapter. A request that did not arrive on a socket (in-process, a fetch handler) has no peer. */
export function recordRemoteAddress(request: Request, address: string | undefined): void {
  if (address !== undefined && address !== "") {
    peers.set(request, normalizeAddress(address));
  }
}

/** The address recorded for this `Request` object, if the Node adapter built it. */
export function remoteAddressOf(request: Request): string | undefined {
  return peers.get(request);
}

/**
 * The address of the peer that connected to the server for the request being served, or `undefined` outside a
 * request or when it did not arrive on a socket. Behind a reverse proxy this is **the proxy**, not the user: read the
 * client's address from the forwarded headers only for proxies you control (see `@blixis-io/security`'s
 * `getClientIp`). Nothing here trusts a header.
 */
export function currentRemoteAddress(): string | undefined {
  return context.get<string>(REMOTE_ADDRESS_KEY);
}
