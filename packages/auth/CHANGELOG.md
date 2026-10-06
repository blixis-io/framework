# @blixis-io/auth

## 0.6.0

### Minor Changes

- [#106](https://github.com/blixis-io/framework/pull/106) [`cfcefa2`](https://github.com/blixis-io/framework/commit/cfcefa207abbd12e6d1ed02c26447f583e24b867) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Refresh-token rotation is safer when something fails or two requests overlap. All additions are optional; a store that implements none of them keeps working.
  
  - A failure part-way no longer strands the client. `refresh()` now loads the claims and signs the new access token before writing anything, and stores the successor *before* it marks the old token rotated, so a failure leaves the old token usable. Before, `markRotated` ran first, and a failure after it (claims lookup, signing, storing the successor) left the client with a rotated token and no replacement.
  - New optional `RefreshTokenStore.rotate(oldTokenHash, next)`: marks the old token rotated and stores the successor in one atomic step. When present, `refresh()` uses it instead of `create` plus `markRotated`.
  - New optional families: `create` now receives a `familyId` (one per sign-in, kept across rotations), and an optional `revokeFamily(familyId)` lets reuse of a stolen token end that login only. Without `revokeFamily`, or for a record without a family, reuse still revokes every refresh token of the subject, as before. `RefreshTokenRecord.familyId` and the exported `NewRefreshToken` type are new.
  - New `issuing.refreshReuseGraceSeconds` (default `0`, off): a token rotated within that window is refused with the usual `401` but nothing is revoked, so a client that refreshes twice at once, or retries a refresh whose response was lost, is not signed out. A stolen token replayed inside the window is also only refused. A negative or non-finite value throws `AuthConfigError` at boot.
  - Behaviour to know: two simultaneous refreshes of one token with the default settings still end the login, and now do so deterministically (the loser's successor is revoked); before, whether the winner's token survived depended on timing.
  
  The package ships no Postgres store; a tested reference is in the docs (`postgres-refresh-store.example.ts` in the repository).

### Patch Changes

- Updated dependencies [[`d8ba3d1`](https://github.com/blixis-io/framework/commit/d8ba3d1a99f38ef0b7a792912585c75dc4cc42d0), [`086eaa8`](https://github.com/blixis-io/framework/commit/086eaa817844318bc1e0bd113cea8da5dcb2d009), [`02329a4`](https://github.com/blixis-io/framework/commit/02329a42ab7c1946e981625b0221e09e7ee05f13), [`416994a`](https://github.com/blixis-io/framework/commit/416994a92e1d152199eb70734fa6de0e806f3545), [`d8ba3d1`](https://github.com/blixis-io/framework/commit/d8ba3d1a99f38ef0b7a792912585c75dc4cc42d0), [`1a34fc4`](https://github.com/blixis-io/framework/commit/1a34fc4afa9874f825eae7ac3d5d75b83600a399)]:
  - @blixis-io/core@0.5.0
  - @blixis-io/http@0.9.0

## 0.5.1

### Patch Changes

- Updated dependencies [[`cfa6381`](https://github.com/blixis-io/framework/commit/cfa6381bdda97bc9e22ffe0f2c32d12fc2453702), [`5f9c5ea`](https://github.com/blixis-io/framework/commit/5f9c5ea9ea541d61328e200b2b539027216ab3f0), [`6146198`](https://github.com/blixis-io/framework/commit/61461988b362941b0d231bb39a7f19bec91273e7), [`2216bc0`](https://github.com/blixis-io/framework/commit/2216bc0d93bb681b82583200814d1caa993bc098), [`47566bc`](https://github.com/blixis-io/framework/commit/47566bcfcf9c9a554e14c9afebccc29f71a06dbe), [`3329a9c`](https://github.com/blixis-io/framework/commit/3329a9c88c3b64724670c20a6809526fca3ef5b8)]:
  - @blixis-io/http@0.8.0

## 0.5.0

### Minor Changes

- [#88](https://github.com/blixis-io/framework/pull/88) [`69b0b21`](https://github.com/blixis-io/framework/commit/69b0b21533fc6ef1cd3468fcbe771176654efc54) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Token verification and password-hash handling are stricter. Two of these can make an app that worked before fail, so read this before upgrading.
  
  **Breaking: the secret must be long enough.** `AuthModule.forRoot()` now throws `AuthConfigError` at boot unless `secret` is at least 32 bytes for `HS256` (the default), 48 for `HS384`, 64 for `HS512` (RFC 7518, section 3.2; bytes of the UTF-8 text). A short secret can be guessed offline from any token. The error states the length it got, never the value. Generate one with `openssl rand -base64 48`. **Changing the secret signs everyone out**: access tokens signed with the old one stop verifying (refresh tokens are stored hashes, not signed, and keep working).
  
  **Breaking: a token must have an `exp`.** A token with a valid signature but no expiry used to be accepted forever; it is now a `401` (`Bearer error="invalid_token"`). Tokens issued by `AUTH_SERVICE` always had one. If another system mints tokens for this app, make it set `exp`.
  
  **New: `issuer` and `audience` options.** When set, a token must carry that `iss` (exactly) and `aud` (any of them, for an array), and tokens from `AUTH_SERVICE` carry them. Use them when staging and production, or two services, share a secret, so one's tokens aren't accepted by the other. Unset, they are neither checked nor added, as before.
  
  **Fix: the `Bearer` scheme is case-insensitive** and may be followed by more than one space (RFC 7235). `bearer <token>` used to be a `401`.
  
  **Fix: `verifyPassword` refuses hashes asking for absurd work.** The Argon2 parameters come from the stored hash string, so a corrupted or attacker-writable hash column could request gigabytes of memory or minutes of CPU per login attempt (a hash asking for 2 GiB made the previous version compute for about 3 seconds). Memory above 1 GiB, more than 20 passes, more than 16 lanes, or a tag outside 4 to 256 bytes now throws, naming the parameters, like any other malformed hash. Hashes from common configurations (OWASP's, 64 MiB with 3 passes and 4 lanes) still verify.

## 0.4.0

### Minor Changes

- [#85](https://github.com/blixis-io/framework/pull/85) [`13e89f8`](https://github.com/blixis-io/framework/commit/13e89f8030871d6cd1937959d48d6ad2a594cf2a) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Four `http` fixes found in the code review, and the `auth` change that uses one of them.
  
  **`request.url` has the right origin.** `listen(0)` used to produce `http://127.0.0.1:0/...` (the requested port, not the bound one), and the `Host` header never mattered. The origin now uses the port actually bound, and IPv6 listen addresses are bracketed (`listen(3000, "::1")` threw). Client headers are still ignored by default, because they are client input. New options opt in: `trustHostHeader` (origin from `Host`) and `trustProxy` (from `X-Forwarded-Proto` and `X-Forwarded-Host`, else `Host`). Only a bare `host[:port]` and an `http`/`https` scheme are accepted; anything else falls back to the listen address. If you build absolute links from `request.url`, you probably want one of these options (or better, a configured public URL).
  
  **JSON media type compared exactly.** The check was a prefix match, so `application/jsonp` and `application/json5` passed as JSON. Now `application/json` and `+json` types (`application/vnd.api+json`) are accepted, a `charset` other than UTF-8 is a `415` (the body was always read as UTF-8), and everything else is a `415` as before.
  
  **`WWW-Authenticate` on a 401.** `UnauthorizedException(detail, challenge?)` sends the challenge as `WWW-Authenticate`, as RFC 9110 requires for a 401. `HttpException` takes a fourth `headers` argument for the same purpose (`retry-after` on a 429, say). Without a challenge nothing is sent, as before. `@blixis-io/auth` now sends `Bearer` when no token was supplied and `Bearer error="invalid_token"` for a token that fails verification or the claims schema (RFC 6750).
  
  **Problem titles from one table.** `422`, `429`, `503` and every other registered 4xx/5xx status now get their reason phrase as `title`; before, only ten statuses did and the rest were titled `"Error"`.

### Patch Changes

- Updated dependencies [[`13e89f8`](https://github.com/blixis-io/framework/commit/13e89f8030871d6cd1937959d48d6ad2a594cf2a)]:
  - @blixis-io/http@0.7.0

## 0.3.0

### Minor Changes

- [#76](https://github.com/blixis-io/framework/pull/76) [`9746012`](https://github.com/blixis-io/framework/commit/9746012b8513e6039a27978946ea4d07abb65f69) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - `@blixis-io/core`, `@blixis-io/di`, `@blixis-io/http`, `zod` and `drizzle-orm` are now **peer dependencies** of the packages that build on them, instead of exact-version dependencies. Before, the libraries pinned exact versions (for example `auth` required `core 0.3.1`), so upgrading `core` by a patch left every library on its own older copy and the app ended up with two. Now your project installs each once and every package shares it; a version that doesn't fit is reported by the package manager at install time.
  
  **What you need to do:** make sure your project depends on what the packages you use build on. pnpm and npm 7+ install missing peers automatically; with yarn or bun, or to be explicit, add them. Per package:
  
  - `core`: `di`
  - `http`: `core`, `di`, `zod`
  - `auth`, `tenancy`, `testing`: `http` (and so `core`, `di`, `zod`); `tenancy` also `drizzle-orm`
  - `openapi`: `http`, `di`, `zod`
  - `config`: `core`, `di`, `zod`
  - `events`, `logging`: `core`, `di`
  - `db`: `core`, `di`, `drizzle-orm` (`pg` is still installed for you)
  
  `create-blixis` now installs `zod`, which `@blixis-io/http` needs. See Installation in the docs for the full table.

### Patch Changes

- Updated dependencies [[`9746012`](https://github.com/blixis-io/framework/commit/9746012b8513e6039a27978946ea4d07abb65f69)]:
  - @blixis-io/core@0.4.0
  - @blixis-io/http@0.6.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`6216026`](https://github.com/blixis-io/framework/commit/6216026a68363c4d901509d0116d52e447c95039), [`e1c471e`](https://github.com/blixis-io/framework/commit/e1c471e79715ca18ccfc009a1912e2b20f41eb08)]:
  - @blixis-io/http@0.5.0

## 0.2.0

### Minor Changes

- [#61](https://github.com/blixis-io/framework/pull/61) [`2c82a76`](https://github.com/blixis-io/framework/commit/2c82a76269cb953d3c3c2c48e534f05d02578800) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - `@Roles(...roles)` and `@Public()` decorators, and an `AuthGuard` that reads them: it authenticates the request unless the route is `@Public()`, then requires one of the listed roles from the token's `roles` claim (401 without a valid token, 403 without the role). A route's own decorator wins over its controller's. Apply `AuthGuard` with `@UseGuards(AuthGuard)`, or opt in to `AuthModule.forRoot({ protectAllRoutes: true })` to require a token on every route and open the exceptions with `@Public()`; a controller added later can't be left open by mistake. `protectAllRoutes` is off by default, so nothing changes until you enable it. `JwtAuthGuard` and `createRolesGuard` are unchanged. Needs `@blixis-io/http` with `@GlobalGuard()` and route metadata.

### Patch Changes

- Updated dependencies [[`3b7c4c8`](https://github.com/blixis-io/framework/commit/3b7c4c8ff0e23d1e88a3dbc800adcbc45d9583f6)]:
  - @blixis-io/http@0.4.0

## 0.1.4

### Patch Changes

- Updated dependencies [[`3b2d859`](https://github.com/blixis-io/framework/commit/3b2d85957cba17f6cfc6273f327c042b25d7ca36)]:
  - @blixis-io/di@0.1.2
  - @blixis-io/core@0.3.1
  - @blixis-io/http@0.3.2

## 0.1.3

### Patch Changes

- Updated dependencies [[`4c34195`](https://github.com/blixis-io/framework/commit/4c34195a621dabc5d2f31e7a4eeed54a2dbc6d45)]:
  - @blixis-io/core@0.3.0
  - @blixis-io/http@0.3.1

## 0.1.2

### Patch Changes

- Updated dependencies [[`fe1f67a`](https://github.com/blixis-io/framework/commit/fe1f67af5657af8d0d2a1ba8ca0aef400617d597), [`bf86ca7`](https://github.com/blixis-io/framework/commit/bf86ca7bb675e0e735a86f37caa6f44d050938f4), [`356e859`](https://github.com/blixis-io/framework/commit/356e859423426fd3984f8a79ec31e315f5809818), [`344bc43`](https://github.com/blixis-io/framework/commit/344bc435f3ce6352f08dcd8ac1e70a81d6da89e4)]:
  - @blixis-io/di@0.1.1
  - @blixis-io/core@0.2.1
  - @blixis-io/http@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`cbc09de`](https://github.com/blixis-io/framework/commit/cbc09de1c8b2fa16d183f2d3b95d0e922c44e7e7), [`9fa4c06`](https://github.com/blixis-io/framework/commit/9fa4c0686fad9bdb6ae95630fdfd739917be87ff), [`cbc09de`](https://github.com/blixis-io/framework/commit/cbc09de1c8b2fa16d183f2d3b95d0e922c44e7e7)]:
  - @blixis-io/core@0.2.0
  - @blixis-io/http@0.2.0
