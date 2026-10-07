---
title: Cookies and CSRF
description: Whether you need cookies at all, how to set and read them safely, how to refuse cross-site requests without tokens, and what is tested and what is not.
sidebar:
  order: 8.66
---

A bearer-token API with no cookies needs no CSRF protection, because a browser never attaches an `Authorization` header by itself. **The moment a credential lives in a cookie, the browser sends it on every request to your domain, including the ones a hostile page makes**, and then you do need it. This page is how to decide, and how to do it safely if you must.

The framework has **no cookie support of its own** (no parsing, no sessions, no CSRF tokens), and `AuthGuard` only reads `Authorization` and `x-api-key`, never a cookie. What is here is a small, tested recipe you copy: `packages/security/src/cookies.example.ts` and `csrf.example.ts`.

## 1. Decide where the credential lives

| Where | CSRF | Script (XSS) | Use it when |
| --- | --- | --- | --- |
| **Access token in memory, sent as `Authorization: Bearer`** (what `examples/saas-api` expects) | Not applicable: nothing is sent automatically. | An XSS can use the token while the page is open. Nothing is left behind once it closes. | A single-page app or a mobile client. The default here. |
| **Access token in memory, refresh token in an `HttpOnly` cookie** limited to the refresh route | Only the refresh and sign-out routes are exposed. Protect those. | A script cannot read the refresh token, which is the long-lived one. | A browser app that must survive a reload without asking for a password. |
| **The access token itself in a cookie**, turned into a bearer by a middleware | Every route is exposed. `originCheck` is **mandatory**. | A script cannot read it. | A server-rendered or same-origin app that wants no token handling in JavaScript. |
| **Token in `localStorage`** | Not applicable. | Any XSS reads it and keeps it. | Avoid. |

`saas-api` today returns its refresh token in the JSON body, so it uses the first row and has no cookies. The rest of this page is for the second and third rows.

## 2. Set and read cookies safely

```ts
import { clearCookie, parseCookies, serializeCookie } from "./cookies.js"; // copied from cookies.example.ts

// at sign-in: a raw Response is the way to set a header, and it skips response validation
const headers = new Headers({ "content-type": "application/json" });
headers.append("set-cookie", serializeCookie("__Host-access", accessToken, { maxAge: 900, sameSite: "Strict" }));
headers.append("set-cookie", serializeCookie("__Secure-refresh", refreshToken, { maxAge: 2_592_000, path: "/auth", sameSite: "Strict" }));
return new Response(JSON.stringify({ ok: true }), { headers });

// in the refresh route
const refreshToken = parseCookies(request.headers.get("cookie")).get("__Secure-refresh");

// at sign-out: the same name and attributes, an empty value, Max-Age=0
headers.append("set-cookie", clearCookie("__Secure-refresh", { path: "/auth", sameSite: "Strict" }));
```

- **`append`, never `set`, for `Set-Cookie`.** `set` replaces the cookies already on the response. `withResponseHeaders` from `@blixis-io/http` uses `set`, so do not use it for cookies. The Node adapter sends each `Set-Cookie` as its own header (checked with a real socket: two cookies arrive as two).
- `serializeCookie` **percent-encodes the value**, so a value can never carry a `;` or a line break into the header, and refuses a name, path or domain that could. Its defaults are the safe ones: `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`.
- `parseCookies` skips what is malformed and lets **the first cookie of a name win**, so a sibling subdomain that plants a second `sid` cannot replace yours.

### Which attributes, and why

- **The `__Host-` prefix** for anything whose loss matters. The browser then refuses the cookie unless it is `Secure`, has `Path=/` and has **no `Domain`**, which stops a sibling subdomain from overwriting it. `serializeCookie` refuses to write a `__Host-` cookie that breaks those rules. A cookie limited to a path (the refresh cookie on `/auth`) cannot be `__Host-`; use `__Secure-` and a path.
- **`HttpOnly`** so script cannot read it. **`Secure`** so it is not sent in clear. Both are defaults.
- **`SameSite=Strict`** for the credential cookies of an app that does not need to log a user in from a link on another site; `Lax` (the default) sends the cookie on top-level navigations from other sites, which is what lets a bookmarked or emailed link arrive logged in. `SameSite` is a second layer: **do not rely on it alone**, because it is about *site*, not *origin*, and a sibling subdomain is the same site.
- **Never `Domain`** unless subdomains must share the cookie. It widens who can read it and who can overwrite it.
- **`Max-Age` the same as the token's life.** A cookie that outlives its token only produces `401`s.
- Browsers silently drop a cookie over 4096 bytes; `serializeCookie` throws instead.

## 3. Refuse cross-site requests, without tokens

```ts
createHttpApplication(AppModule, {
  middleware: [
    health.middleware,
    requestId(),
    accessLog({ /* ... */ }),
    cors({ origins: ["https://app.example.com"], credentials: true }),   // explicit origins; "*" with credentials is refused
    securityHeaders(),
    originCheck({ trustedOrigins: ["https://app.example.com"] }),         // before anything that turns a cookie into a credential
    cookieToBearer({ cookie: "__Host-access" }),                          // only for the third row of the table
    rateLimit({ /* ... */ }),
  ],
});
```

`originCheck` (from `csrf.example.ts`) uses what the browser itself reports, in headers a page's script cannot set, so there is no token to issue, store or forget:

- `GET`, `HEAD` and `OPTIONS` pass. **They must not change anything**, or nothing here protects it.
- `Origin` in `trustedOrigins`: passes (a separate front end on its own domain).
- `Sec-Fetch-Site: same-origin` or `none` (a typed address, a bookmark): passes. **`same-site` and `cross-site` are refused** unless the origin is trusted: a sibling subdomain can belong to someone else.
- Neither header: not a browser, or too old to say. It passes, because CSRF abuses the cookies a *browser* attaches by itself.
- An older browser (an `Origin`, no `Sec-Fetch-Site`): the origin's host must equal the request's `Host`. **Behind a proxy that rewrites `Host`, list your public origin in `trustedOrigins`.**

Everything else is a `403`, and the application never runs. This includes the **sign-in** `POST`, which closes "login CSRF", where an attacker signs the victim into the attacker's account.

`cookieToBearer` is what lets the rest of the application keep reading only `Authorization`: with no `Authorization` header and the named cookie present, the cookie's value becomes the bearer token and the normal guard verifies it. An explicit `Authorization` header always wins. It exists to be used **after** `originCheck`, and a test checks that order: a cross-site request carrying the cookie is refused before it becomes a credential.

### Why not CSRF tokens

Tokens (a synchronizer token, or a double-submit cookie) work and are the answer when you must support browsers that send neither header. They need state or a cookie to manage, a way to hand the token to the page, and discipline on every form and request. The header check needs none of that and fails closed. If you need tokens as well, add them in front of the same routes; this recipe does not issue them.

## 4. Things that still go wrong

- **XSS defeats all of this.** A script running on your page can make same-origin requests, which `originCheck` correctly allows. `HttpOnly` stops it reading the cookie, not using it. Keep `securityHeaders()` (with a real `Content-Security-Policy` for a page that serves HTML) and escape output.
- **State-changing `GET`.** `GET /sign-out` or `GET /delete?id=1` is open to CSRF whatever you do here. Use `POST` or `DELETE`.
- **CORS is not CSRF protection.** CORS stops a hostile page *reading* a response; a "simple" `POST` is still **sent**, and its effect still happens. That is what `originCheck` is for.
- **`cors({ credentials: true })` with `"*"` is refused when the middleware is created**, and echoing back any origin would let any site make authenticated requests as your user. List the origins.
- **Do not log `Cookie` or `Set-Cookie`.** `accessLog` records method, path, status and duration only; check that your own `onError` and logger do not add request headers.
- **Subdomains.** A cookie on a parent `Domain`, or any untrusted subdomain you host (user pages, a forgotten staging host), reopens what `__Host-` and the same-site refusal close.

## What is tested, and what is not

Tested (`packages/security`, 57 tests) with the real application and a real socket, and by fuzzing: every row of the `originCheck` rules (same-site, cross-site, opaque `null` origin, unparseable origin, same host on another port, trusted origin by exact match only, a lookalike domain), the bridge never overriding an explicit `Authorization` header, the order of the two middleware, two `Set-Cookie` headers surviving the Node adapter as two headers, and, for the helpers, that any string round-trips and that no value can add an attribute or a header. Each rule was checked by removing the line that provides it and watching a test fail.

Not tested: a **real browser**, so the `Sec-Fetch-Site` and `Origin` headers are set by hand the way a browser documents setting them; older browsers and Safari's handling of `SameSite`; a proxy that rewrites `Host`; and the bridge together with `AuthGuard` (the bridge is tested to deliver the right `Authorization` header, and `AuthGuard` is tested to accept one, but not in the same request).
