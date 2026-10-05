# @blixis-io/auth

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
