/**
 * Cookie helpers for a browser-facing app, the ones `guides/cookies-and-csrf` uses. Not exported from the package (the
 * framework has no cookie support of its own, and these are small enough to own): copy them. `cookies.example.test`
 * checks them, including against hostile input.
 *
 * `serializeCookie` is strict where `Set-Cookie` is dangerous: the **value is always percent-encoded**, so it can never
 * carry a `;` or a line break into the header, and the name, path and domain are refused when they hold anything a
 * header could be split with. Defaults are the safe ones (`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`).
 */
export interface CookieOptions {
  /** Seconds. `0` deletes the cookie. Omit for a session cookie. */
  maxAge?: number;
  /** Default `/`. */
  path?: string;
  /** Leave unset (the browser then keeps the cookie to this exact host) unless subdomains must share it. Not allowed with `__Host-`. */
  domain?: string;
  /** Default `true`. Browsers only send a `Secure` cookie over HTTPS (and to `localhost`). */
  secure?: boolean;
  /** Default `true`: script cannot read it, which is what keeps an XSS from stealing a session. */
  httpOnly?: boolean;
  /** Default `"Lax"`. `"None"` is for cross-site use and requires `secure`. */
  sameSite?: "Strict" | "Lax" | "None";
}

/** RFC 9110 `token`: what a cookie name may be made of. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const PATH = /^\/[!-:<-~]*$/;
const DOMAIN = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
/** Browsers drop a cookie bigger than this, silently. */
const MAX_BYTES = 4096;

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const { maxAge, path = "/", domain, secure = true, httpOnly = true, sameSite = "Lax" } = options;
  if (!TOKEN.test(name)) {
    throw new TypeError(`"${name}" is not a valid cookie name.`);
  }
  if (!PATH.test(path)) {
    throw new TypeError(`"${path}" is not a valid cookie path.`);
  }
  if (domain !== undefined && !DOMAIN.test(domain)) {
    throw new TypeError(`"${domain}" is not a valid cookie domain.`);
  }
  if (maxAge !== undefined && (!Number.isInteger(maxAge) || maxAge < 0)) {
    throw new RangeError("maxAge must be a whole number of seconds, 0 or more.");
  }
  if (sameSite === "None" && !secure) {
    throw new TypeError("SameSite=None requires Secure: browsers refuse the cookie otherwise.");
  }
  // The prefixes are promises the browser enforces; refuse to write a cookie that breaks the promise its name makes.
  if ((name.startsWith("__Host-") || name.startsWith("__Secure-")) && !secure) {
    throw new TypeError(`A cookie named "${name}" must be Secure.`);
  }
  if (name.startsWith("__Host-") && (path !== "/" || domain !== undefined)) {
    throw new TypeError(`A "__Host-" cookie must have Path=/ and no Domain.`);
  }

  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`];
  if (maxAge !== undefined) {
    parts.push(`Max-Age=${maxAge}`);
  }
  if (domain !== undefined) {
    parts.push(`Domain=${domain}`);
  }
  if (secure) {
    parts.push("Secure");
  }
  if (httpOnly) {
    parts.push("HttpOnly");
  }
  parts.push(`SameSite=${sameSite}`);

  const header = parts.join("; ");
  if (Buffer.byteLength(header) > MAX_BYTES) {
    throw new RangeError(`The cookie is ${Buffer.byteLength(header)} bytes; browsers drop one over ${MAX_BYTES}.`);
  }
  return header;
}

/** A cookie that removes `name`: same name and attributes, an empty value, `Max-Age=0`. The attributes must match the ones it was set with. */
export function clearCookie(name: string, options: Omit<CookieOptions, "maxAge"> = {}): string {
  return serializeCookie(name, "", { ...options, maxAge: 0 });
}

/**
 * Reads a `Cookie` request header. Malformed pairs are skipped, a value that is not valid percent-encoding is skipped, and
 * when a name appears twice **the first one wins**: browsers send the most specific path first, and a sibling subdomain
 * can plant a second cookie of the same name, which must not replace yours.
 */
export function parseCookies(header: string | null | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const pair of (header ?? "").split(";")) {
    const equals = pair.indexOf("=");
    if (equals === -1) {
      continue;
    }
    const name = pair.slice(0, equals).trim();
    let raw = pair.slice(equals + 1).trim();
    if (!TOKEN.test(name) || cookies.has(name)) {
      continue;
    }
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
      raw = raw.slice(1, -1);
    }
    try {
      cookies.set(name, decodeURIComponent(raw));
    } catch {
      // not valid percent-encoding: not ours
    }
  }
  return cookies;
}
