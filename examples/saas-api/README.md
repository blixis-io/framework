# saas-api

The framework's reference application: a small multi-tenant API that puts the production pieces together. Accounts and sign-in with refresh-token rotation, organizations and spaces, tenant-scoped projects with child tasks, migrations, one transaction, an error contract, OpenAPI with security, request-id logs, health checks and the browser/abuse baseline. It is deliberately **small**: every part is here because the framework makes it work, not to be a product.

Read it next to the guides it exercises: [Securing the API](https://blixis-io.github.io/framework/guides/securing-the-api/), [Health checks](https://blixis-io.github.io/framework/guides/health-checks/), [Logging requests and errors](https://blixis-io.github.io/framework/guides/logging-requests-and-errors/), [Issuing tokens](https://blixis-io.github.io/framework/guides/issuing-tokens/), [Tenancy](https://blixis-io.github.io/framework/concepts/tenancy/).

## Run it

You need Node 24+, pnpm and Docker (for Postgres), from the repository root:

```bash
pnpm install && pnpm run build
docker compose up -d postgres                         # Postgres on :5434
cd examples/saas-api
export DATABASE_URL=postgres://blixis:blixis@localhost:5434/blixis
export JWT_SECRET="$(openssl rand -base64 48)"
pnpm exec blix run db:migrate                         # applies migrations/*.sql, once per release
pnpm start                                            # http://localhost:3000
```

```bash
curl -s localhost:3000/auth/sign-up -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"correct horse battery","organizationName":"Acme"}'
# { "accessToken": "...", "refreshToken": "...", ... }

curl -s localhost:3000/me -H "authorization: Bearer $ACCESS"          # the spaces you may act in
curl -s localhost:3000/spaces/$SPACE/projects -H "authorization: Bearer $ACCESS" \
  -H 'content-type: application/json' -d '{"title":"First project"}'
curl -s localhost:3000/readyz        # 200 while healthy, 503 while draining
curl -s localhost:3000/openapi.json  # public, with bearer security declared
```

## Run it as a container

`Dockerfile` builds the production image: it builds with every dependency, then ships `dist/`, `migrations/` and the production dependencies only, as the non-root `node` user. This folder lives in a workspace (`workspace:*` dependencies, no lockfile of its own), so build from a **copy** of it with real versions and a `package-lock.json`:

```bash
cp -r examples/saas-api /tmp/saas-api && cd /tmp/saas-api   # then set the @blixis-io/* versions and the tsconfig `extends`
npm install && docker build -t saas-api .
docker run --rm -e DATABASE_URL=... -e JWT_SECRET=... saas-api npx blix run db:migrate   # a deploy step, once per release
docker run -p 3000:3000 -e DATABASE_URL=... -e JWT_SECRET=... saas-api
```

`node scripts/docker-image.mjs` at the repository root does exactly that on every pull request (packages from this checkout, a throwaway Postgres): it migrates with the image twice, boots it, signs a user up, calls an authenticated route, checks the user is not root, and stops it with `SIGTERM` expecting the drain and exit 0. It needs Docker. Not checked: your registry, your orchestrator's probes and signal handling, TLS (terminate it at the proxy).

Tests (real Postgres on :5434, nothing mocked): `pnpm exec vitest run` in this directory. `pnpm run ci` at the root runs them with everything else.

## Where each thing is

| What | Where | Shows |
| --- | --- | --- |
| The middleware order, the whole point | `src/app.ts` | health first, request id and access log, CORS and headers outside the limiters, a strict limit on sign-in and a loose one on the rest, `onError` tied to the request id |
| Config that refuses to boot half-configured | `src/config.ts` | no default for `DATABASE_URL`, `JWT_SECRET` at least 32 bytes |
| Module graph per environment | `src/app.module.ts` | `protectAllRoutes: true`: every route needs a token unless `@Public()` |
| Sign-up in one transaction | `src/auth/accounts.service.ts` | `@Transactional()` over user, organization, space and membership; a taken email rolls everything back (409) |
| Refresh tokens | `src/auth/refresh-token-store.ts` | atomic `rotate()`, one login per family, replay ends only that login |
| Tenant isolation | `src/projects/projects.service.ts` | `tenantScope()` in every read, update, delete and join, tenant columns from the guard and never the body, ids that are not uuids are 404 |
| The database backs it up | `migrations/0001_init.sql` | the composite key `(project_id, space_id)` so a task cannot point at another space's project |
| Membership check | `src/tenancy/` | `TenantScopedGuard`: 404, never 403, to a non-member |
| Migrations | `src/db/migrate.ts` and `migrate.command.ts` | plain SQL files, each in a transaction, an advisory lock, `blix run db:migrate` as a deploy step |
| Events that survive a crash | `src/outbox/`, `migrations/0002_outbox.sql`, `src/projects/projects.service.ts` | the event is a row written in the same transaction as the project; a relay delivers it at least once (`for update skip locked`, backoff, parking) to an idempotent consumer; see the [outbox guide](https://blixis-io.github.io/framework/guides/transactional-outbox/) |
| API keys for machines | `src/api-keys/`, `migrations/0003_api_keys.sql`, `src/tenancy/tenancy.ts` | a space's owners create keys (shown once, only a SHA-256 stored), scoped (`projects:read`, `projects:write`), optionally limited to networks and to an expiry; a key acts in **one** space and is a 404 anywhere else; `scopedRoutesOnly` closes every route nobody annotated (`/me`, key management); a limit **per verified key**, not per claimed id; revoking is immediate; see the [reference](https://blixis-io.github.io/framework/reference/blixis-auth/#api-keys) |
| Rate-limit counters shared by every replica | `src/platform/rate-limit-store.ts` | one upsert in the application's database |
| Readiness | `src/platform/` | a database check registered by the provider that owns the database; `503 draining` on shutdown |
| OpenAPI | `src/app.ts`, `src/auth/auth.controller.ts` | `securitySchemes`, `@ApiSecurity(false)` on the public routes |
| Shutdown | `src/main.ts` | on SIGTERM: start draining, give the balancer time to notice, then close |

## What the tests prove

`accounts.e2e.test.ts` (sign-up, sign-in, tokens, replay, sign-out), `tenancy.e2e.test.ts` (own space, **denied**: non-member 404 on every route, id substitution, forged tenant in a body, a user in two spaces, the database's own refusal), `platform.e2e.test.ts` (request ids, CORS, headers, health), `ratelimit.e2e.test.ts` (429 with `Retry-After` and CORS headers, per-client limits, `X-Forwarded-For` read from the end, **one limit across two instances**), `lifecycle.e2e.test.ts` (readiness flips on drain), `openapi.test.ts`, `migrate.test.ts` (idempotent, safe under concurrency, a failing file rolls back whole).

## Deploying

`blix.config.ts` has a Docker target (`blix deploy --dry-run` prints what it would do). The example depends on the monorepo's workspace packages, so an image is built from a *copy* of it: copy the directory out, replace the `workspace:*` versions in `package.json` with the published ones, add a lockfile, run `pnpm exec blix deploy init --target docker`, and add `COPY migrations ./migrations` to the generated Dockerfile (migrations are SQL files the app reads at run time). Run `blix run db:migrate` once per release, **before** the new version starts, not from every replica at boot. Put `TRUSTED_PROXY_HOPS` at the number of proxies you run, and make sure the server is reachable only through them.

## Limits, on purpose

- **One application per process.** The membership lookup (`src/tenancy/tenancy.ts`) holds the booted database in a module-level holder, because `defineTenancyModule` wants a plain function. Fine for a service; tests that start several applications put them in separate files.
- **No invitations, password reset, email verification or roles beyond `owner`/`member`.** Real products need them; the pattern would not change.
- **`@blixis-io/security` and `@blixis-io/health` are published as `0.1.0` with the next release**; until then they are workspace packages, and this example runs inside the monorepo.
- The Docker image was not built here (see above), and nothing was run behind a real proxy or CDN.
