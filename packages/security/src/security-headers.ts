import { withResponseHeaders, type Middleware } from "@blixis-io/http";

export interface SecurityHeadersOptions {
  /** Default `nosniff`. `false` leaves it out. */
  contentTypeOptions?: string | false;
  /** Default `no-referrer`. */
  referrerPolicy?: string | false;
  /** Default `DENY`. An API has no business being framed. */
  frameOptions?: string | false;
  /** Default `default-src 'none'; frame-ancestors 'none'`: a JSON API serves nothing a browser should run or embed. */
  contentSecurityPolicy?: string | false;
  /** Default `same-origin`. */
  crossOriginResourcePolicy?: string | false;
  /**
   * `Strict-Transport-Security`. **Off by default**, because only you know the site is served over HTTPS everywhere and
   * will stay that way (browsers remember it for `maxAge` seconds, and `preload` is very hard to undo).
   */
  hsts?: { maxAge: number; includeSubDomains?: boolean; preload?: boolean } | false;
  /** Replace a header the application already set. Default `false`: the route's own value wins. */
  override?: boolean;
}

/**
 * Conservative response headers for a JSON API, on every response including errors and `404`s. Each can be changed or
 * turned off with `false`; none replaces a header the application set itself unless `override` is on. Put it near the
 * front of `middleware`.
 */
export function securityHeaders(options: SecurityHeadersOptions = {}): Middleware {
  const wanted: Array<[string, string | false | undefined]> = [
    ["x-content-type-options", options.contentTypeOptions ?? "nosniff"],
    ["referrer-policy", options.referrerPolicy ?? "no-referrer"],
    ["x-frame-options", options.frameOptions ?? "DENY"],
    ["content-security-policy", options.contentSecurityPolicy ?? "default-src 'none'; frame-ancestors 'none'"],
    ["cross-origin-resource-policy", options.crossOriginResourcePolicy ?? "same-origin"],
  ];
  const hsts = options.hsts;
  if (hsts) {
    if (!Number.isInteger(hsts.maxAge) || hsts.maxAge < 0) {
      throw new RangeError(`securityHeaders(): hsts.maxAge must be a whole number of seconds, 0 or more (got ${hsts.maxAge}).`);
    }
    wanted.push(["strict-transport-security", `max-age=${hsts.maxAge}${hsts.includeSubDomains ? "; includeSubDomains" : ""}${hsts.preload ? "; preload" : ""}`]);
  }
  const headers = wanted.filter((entry): entry is [string, string] => typeof entry[1] === "string");
  const override = options.override ?? false;

  return async (_request, next) => {
    const response = await next();
    const missing = Object.fromEntries(headers.filter(([name]) => override || !response.headers.has(name)));
    return Object.keys(missing).length === 0 ? response : withResponseHeaders(response, missing);
  };
}
