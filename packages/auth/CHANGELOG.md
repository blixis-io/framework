# @blixis-io/auth

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
