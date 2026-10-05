---
"@blixis-io/http": minor
"@blixis-io/auth": minor
---

Four `http` fixes found in the code review, and the `auth` change that uses one of them.

**`request.url` has the right origin.** `listen(0)` used to produce `http://127.0.0.1:0/...` (the requested port, not the bound one), and the `Host` header never mattered. The origin now uses the port actually bound, and IPv6 listen addresses are bracketed (`listen(3000, "::1")` threw). Client headers are still ignored by default, because they are client input. New options opt in: `trustHostHeader` (origin from `Host`) and `trustProxy` (from `X-Forwarded-Proto` and `X-Forwarded-Host`, else `Host`). Only a bare `host[:port]` and an `http`/`https` scheme are accepted; anything else falls back to the listen address. If you build absolute links from `request.url`, you probably want one of these options (or better, a configured public URL).

**JSON media type compared exactly.** The check was a prefix match, so `application/jsonp` and `application/json5` passed as JSON. Now `application/json` and `+json` types (`application/vnd.api+json`) are accepted, a `charset` other than UTF-8 is a `415` (the body was always read as UTF-8), and everything else is a `415` as before.

**`WWW-Authenticate` on a 401.** `UnauthorizedException(detail, challenge?)` sends the challenge as `WWW-Authenticate`, as RFC 9110 requires for a 401. `HttpException` takes a fourth `headers` argument for the same purpose (`retry-after` on a 429, say). Without a challenge nothing is sent, as before. `@blixis-io/auth` now sends `Bearer` when no token was supplied and `Bearer error="invalid_token"` for a token that fails verification or the claims schema (RFC 6750).

**Problem titles from one table.** `422`, `429`, `503` and every other registered 4xx/5xx status now get their reason phrase as `title`; before, only ten statuses did and the rest were titled `"Error"`.
