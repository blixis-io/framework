import { HttpException, type Middleware } from "@blixis-io/http";
import { parseCookies } from "./cookies.example.js";

/**
 * CSRF protection and a cookie-to-token bridge, the ones `guides/cookies-and-csrf` uses. Not exported from the package:
 * copy them. `csrf.example.test` runs them through the real application and a real socket.
 */
export interface OriginCheckOptions {
  /** Origins (`https://app.example.com`) allowed to make unsafe requests across origins: a separate front end, say. */
  trustedOrigins?: readonly string[];
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Refuses a state-changing request that a browser says came from another site. No token and no session to store: the
 * browser tells the server where the request came from, in headers a page's script cannot set.
 *
 * - `GET`, `HEAD` and `OPTIONS` pass. **They must not change anything**, or this protects nothing.
 * - `Origin` in `trustedOrigins`: passes.
 * - `Sec-Fetch-Site: same-origin` or `none` (the user typed it, or used a bookmark): passes. `same-site` (a sibling
 *   subdomain, which may belong to someone else) and `cross-site` are refused unless the origin is trusted.
 * - No `Sec-Fetch-Site` and no `Origin`: not a browser, or one too old to say. It passes, because CSRF abuses the cookies a
 *   *browser* attaches by itself; a script or a server using the API has none it did not choose to send.
 * - An older browser (an `Origin`, no `Sec-Fetch-Site`): the origin's host must equal the request's `Host`. Behind a proxy
 *   that rewrites `Host`, list the public origin in `trustedOrigins`.
 *
 * Put it **before** anything that turns a cookie into a credential, and after `cors()` so a refusal carries CORS headers.
 */
export function originCheck(options: OriginCheckOptions = {}): Middleware {
  const trusted = new Set((options.trustedOrigins ?? []).map((origin) => origin.replace(/\/$/, "")));
  for (const origin of trusted) {
    if (origin === "*" || !URL.canParse(origin) || new URL(origin).origin !== origin) {
      throw new TypeError(`trustedOrigins entry "${origin}" is not an origin such as https://app.example.com.`);
    }
  }

  return (request, next) => {
    if (SAFE_METHODS.has(request.method)) {
      return next();
    }
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    if (origin !== null && trusted.has(origin)) {
      return next();
    }
    if (site === "same-origin" || site === "none") {
      return next();
    }
    if (site === null) {
      if (origin === null) {
        return next(); // not a browser (or too old to say)
      }
      const host = request.headers.get("host") ?? new URL(request.url).host;
      if (URL.canParse(origin) && new URL(origin).host === host) {
        return next();
      }
    }
    throw new HttpException(403, "Cross-origin request refused");
  };
}

/**
 * Lets a browser app authenticate with a cookie while the rest of the application only knows `Authorization: Bearer`:
 * when a request has no `Authorization` header and carries the named cookie, the cookie's value becomes the bearer token.
 * An explicit `Authorization` header always wins. The token is still verified by the normal guard.
 *
 * **A cookie is sent by the browser on its own, so this makes the app open to CSRF unless `originCheck` runs first.**
 */
export function cookieToBearer(options: { cookie: string }): Middleware {
  return (request, next) => {
    if (request.headers.has("authorization")) {
      return next();
    }
    const token = parseCookies(request.headers.get("cookie")).get(options.cookie);
    if (token === undefined || token === "") {
      return next();
    }
    const headers = new Headers(request.headers);
    headers.set("authorization", `Bearer ${token}`);
    return next(new Request(request, { headers }));
  };
}
