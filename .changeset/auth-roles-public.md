---
"@blixis-io/auth": minor
---

`@Roles(...roles)` and `@Public()` decorators, and an `AuthGuard` that reads them: it authenticates the request unless the route is `@Public()`, then requires one of the listed roles from the token's `roles` claim (401 without a valid token, 403 without the role). A route's own decorator wins over its controller's. Apply `AuthGuard` with `@UseGuards(AuthGuard)`, or opt in to `AuthModule.forRoot({ protectAllRoutes: true })` to require a token on every route and open the exceptions with `@Public()`; a controller added later can't be left open by mistake. `protectAllRoutes` is off by default, so nothing changes until you enable it. `JwtAuthGuard` and `createRolesGuard` are unchanged. Needs `@blixis-io/http` with `@GlobalGuard()` and route metadata.
