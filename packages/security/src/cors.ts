import { withResponseHeaders, type Middleware } from "@blixis-io/http";
import { SecurityConfigError } from "./errors.js";

export interface CorsOptions {
  /**
   * Who may call this API from a browser: exact origins (`"https://app.example.com"`, no path, no trailing slash), a
   * function that decides, or `"*"` for any origin. `"*"` cannot be combined with `credentials`.
   */
  origins: readonly string[] | "*" | ((origin: string) => boolean);
  /** Default `GET, HEAD, PUT, PATCH, POST, DELETE`. */
  methods?: readonly string[];
  /** Request headers a browser may send. Default: whatever the preflight asks for. */
  allowedHeaders?: readonly string[];
  /** Response headers a browser's script may read (beyond the safe ones). */
  exposedHeaders?: readonly string[];
  /** Let the browser send cookies and `Authorization` headers. Needs explicit origins, never `"*"`. Default `false`. */
  credentials?: boolean;
  /** Seconds a browser may cache a preflight answer. Default 600. */
  maxAge?: number;
}

const DEFAULT_METHODS = ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"];

function assertOrigin(value: string): void {
  if (value === "*") {
    return;
  }
  let origin: string;
  try {
    origin = new URL(value).origin;
  } catch {
    throw new SecurityConfigError(`cors(): "${value}" is not an origin. Use something like "https://app.example.com".`);
  }
  if (origin !== value) {
    throw new SecurityConfigError(`cors(): "${value}" is not an exact origin (scheme, host and port only; no path or trailing slash). Did you mean "${origin}"?`);
  }
}

function appendVary(response: Response, ...names: string[]): Response {
  const existing = response.headers.get("vary");
  const present = new Set((existing ?? "").split(",").map((name) => name.trim().toLowerCase()));
  const missing = names.filter((name) => !present.has(name.toLowerCase()));
  if (missing.length === 0) {
    return response;
  }
  return withResponseHeaders(response, { vary: [...(existing ? [existing] : []), ...missing].join(", ") });
}

/**
 * Cross-origin access for browsers, with explicit origins. Put it **first** in `middleware`, so a `404`, a `401`, a `429`
 * or a `500` carries the same headers as a success; without them the browser hides the real status from your script.
 *
 * - A request from an allowed origin gets `Access-Control-Allow-Origin` (the origin itself, or `*`), and `Vary: Origin`.
 * - A preflight (`OPTIONS` with `Access-Control-Request-Method`) from an allowed origin is answered here with `204`; from
 *   any other origin it is answered `204` with no CORS headers, which makes the browser refuse the real request.
 * - Credentials with `"*"` is refused when this is called, not at the first request.
 *
 * CORS is the browser's rule, not access control: a script outside a browser ignores it. Authorize with guards.
 */
export function cors(options: CorsOptions): Middleware {
  const { origins } = options;
  const credentials = options.credentials ?? false;
  const wildcard = origins === "*" || (Array.isArray(origins) && origins.includes("*"));
  if (Array.isArray(origins)) {
    origins.forEach(assertOrigin);
  } else if (typeof origins === "string") {
    assertOrigin(origins);
  }
  if (wildcard && credentials) {
    throw new SecurityConfigError(
      'cors(): credentials: true cannot be combined with origins "*". A browser refuses it, and echoing every origin back instead would let any website make authenticated requests as your user. List the origins that may.',
    );
  }
  const maxAge = options.maxAge ?? 600;
  if (!Number.isInteger(maxAge) || maxAge < 0) {
    throw new SecurityConfigError(`cors(): maxAge must be a whole number of seconds, 0 or more (got ${maxAge}).`);
  }
  const methods = (options.methods ?? DEFAULT_METHODS).join(", ");

  const allowed = (origin: string): boolean => {
    if (wildcard) {
      return true;
    }
    return typeof origins === "function" ? origins(origin) : origins.includes(origin);
  };

  return async (request, next) => {
    const origin = request.headers.get("origin");
    if (origin === null) {
      // Not a cross-origin browser request. Same-origin and non-browser clients send no Origin.
      return appendVary(await next(), "Origin");
    }

    const isAllowed = allowed(origin);
    const allowOrigin = wildcard ? "*" : origin;
    const isPreflight = request.method === "OPTIONS" && request.headers.has("access-control-request-method");

    if (isPreflight) {
      const headers: Record<string, string> = { vary: "Origin, Access-Control-Request-Headers" };
      if (isAllowed) {
        headers["access-control-allow-origin"] = allowOrigin;
        headers["access-control-allow-methods"] = methods;
        const requested = request.headers.get("access-control-request-headers");
        const allowedHeaders = options.allowedHeaders?.join(", ") ?? requested;
        if (allowedHeaders) {
          headers["access-control-allow-headers"] = allowedHeaders;
        }
        headers["access-control-max-age"] = String(maxAge);
        if (credentials) {
          headers["access-control-allow-credentials"] = "true";
        }
      }
      return new Response(null, { status: 204, headers });
    }

    const response = await next();
    if (!isAllowed) {
      return wildcard ? response : appendVary(response, "Origin");
    }
    const added: Record<string, string> = { "access-control-allow-origin": allowOrigin };
    if (credentials) {
      added["access-control-allow-credentials"] = "true";
    }
    if (options.exposedHeaders && options.exposedHeaders.length > 0) {
      added["access-control-expose-headers"] = options.exposedHeaders.join(", ");
    }
    const withCors = withResponseHeaders(response, added);
    return wildcard ? withCors : appendVary(withCors, "Origin");
  };
}
