---
"@blixis-io/auth": minor
---

Token verification and password-hash handling are stricter. Two of these can make an app that worked before fail, so read this before upgrading.

**Breaking: the secret must be long enough.** `AuthModule.forRoot()` now throws `AuthConfigError` at boot unless `secret` is at least 32 bytes for `HS256` (the default), 48 for `HS384`, 64 for `HS512` (RFC 7518, section 3.2; bytes of the UTF-8 text). A short secret can be guessed offline from any token. The error states the length it got, never the value. Generate one with `openssl rand -base64 48`. **Changing the secret signs everyone out**: access tokens signed with the old one stop verifying (refresh tokens are stored hashes, not signed, and keep working).

**Breaking: a token must have an `exp`.** A token with a valid signature but no expiry used to be accepted forever; it is now a `401` (`Bearer error="invalid_token"`). Tokens issued by `AUTH_SERVICE` always had one. If another system mints tokens for this app, make it set `exp`.

**New: `issuer` and `audience` options.** When set, a token must carry that `iss` (exactly) and `aud` (any of them, for an array), and tokens from `AUTH_SERVICE` carry them. Use them when staging and production, or two services, share a secret, so one's tokens aren't accepted by the other. Unset, they are neither checked nor added, as before.

**Fix: the `Bearer` scheme is case-insensitive** and may be followed by more than one space (RFC 7235). `bearer <token>` used to be a `401`.

**Fix: `verifyPassword` refuses hashes asking for absurd work.** The Argon2 parameters come from the stored hash string, so a corrupted or attacker-writable hash column could request gigabytes of memory or minutes of CPU per login attempt (a hash asking for 2 GiB made the previous version compute for about 3 seconds). Memory above 1 GiB, more than 20 passes, more than 16 lanes, or a tag outside 4 to 256 bytes now throws, naming the parameters, like any other malformed hash. Hashes from common configurations (OWASP's, 64 MiB with 3 passes and 4 lanes) still verify.
