---
title: saas-api Walkthrough
description: A tour of the multi-tenant reference application, examples/saas-api, and where each production concern lives in it.
sidebar:
  order: 2
---

[`examples/hello-api`](/framework/examples/hello-api-walkthrough/) shows the basics. `examples/saas-api` shows what is left once you want to put something on the internet: accounts, tenants, abuse limits, health checks, migrations, logs you can follow. It is deliberately small: every part is there because the framework makes it work, and the [README](https://github.com/blixis-io/framework/blob/main/examples/saas-api/README.md) has the commands to run it and a table of where each thing is. This page is the reading order.

## 1. Start at the middleware, `src/app.ts`

The order of the `middleware` array is the design:

1. **`health.middleware`** answers `/livez` and `/readyz` before anything else, so a load balancer's probes are not logged or rate-limited.
2. **`requestId()` and `accessLog()`**: every response, a `404` and a `429` included, carries an id and gets a log line. `onError` logs unexpected errors with the same id, so a user's "it failed, id `abc`" finds the line.
3. **`cors()` and `securityHeaders()`** sit *outside* the limiters, so even a rejected request carries them. Without CORS headers a browser hides the real status from the front end.
4. **Two `rateLimit()`s**: ten sign-in, sign-up and refresh attempts a minute per client (that is where passwords are guessed, and it refuses rather than allows if the limiter's database is down), and a looser one for everything else. The counters live in the application's own database, so the limit holds across replicas. The client is read from the **end** of `X-Forwarded-For`, counting the proxies you say you run.

Concepts: [Middleware](/framework/concepts/middleware/), [Securing the API](/framework/guides/securing-the-api/), [Logging requests and errors](/framework/guides/logging-requests-and-errors/).

## 2. Accounts, `src/auth/`

- `protectAllRoutes: true`: every route needs a token unless it says `@Public()`. The public routes also say `@ApiSecurity(false)`, because the guard and the OpenAPI document are two different things to keep in step.
- **Sign-up is one transaction** (`@Transactional()`): the user, their organization, a first space and the membership either all exist or none do. A taken email rolls back and answers `409`.
- **Refresh tokens** use the Drizzle store with an atomic `rotate()` and families: replaying one device's old token ends only that login. See [Issuing tokens](/framework/guides/issuing-tokens/#making-rotation-resilient).

## 3. Tenants, `src/tenancy/` and `src/projects/`

`TenantScopedGuard` checks the caller belongs to the `:spaceId` in the URL and answers `404`, never `403`, to a non-member. The service then puts `tenantScope()` in **every** query, takes the tenant as an argument (so a background job can call it with a tenant it builds), takes the tenant columns of a new row from the guard and never the body, and treats an id that is not a uuid as a `404`. The schema backs it up: a task's composite foreign key `(project_id, space_id)` means the database refuses a task whose project is in another space. The tests attack each of these. See [Tenancy](/framework/concepts/tenancy/#the-pattern-for-every-kind-of-query).

## 4. Operations

- **Migrations** are plain SQL files applied by `blix run db:migrate`, each in a transaction, under an advisory lock. Run it once per release, before the new version starts.
- **Health**: the provider that owns the database registers the readiness check. On SIGTERM, `main.ts` starts draining (`/readyz` answers `503`), waits for the balancer to notice, then closes.
- **Configuration** refuses to boot half-configured: no default for `DATABASE_URL`, a `JWT_SECRET` of at least 32 bytes.

## What it proves, and what it does not

45 tests against a real Postgres, nothing mocked: the happy path, **every denied case** (a non-member, another organization's id through your own space, a forged tenant in a body, a user in two spaces, the `429`), one rate limit across two instances, request ids tying logs to responses, readiness flipping on drain, and the OpenAPI document. It has no invitations, password reset or email verification, runs one application per process, and was not run behind a real proxy or built into a Docker image. The README lists these.
