---
title: Tenancy
description: Request-scoped multi-tenant access control — TenantScopedGuard, tenantScope(), and the fail-closed rules behind both.
sidebar:
  order: 18
---

`@blixis-io/tenancy` provides the *mechanism* for scoping requests and queries to a tenant — a `TenantScopedGuard` that resolves and verifies a tenant from a route, and a `tenantScope()` database helper that refuses to build an unscoped query. It does **not** provide an Organization/Space/Membership data model — that's application data, supplied via one function you write. This keeps the package usable by any multi-tenant app, not just a CMS.

## The shape

Hierarchy: **Organization → Space → Environment**. A route names a space (`:spaceId`) and, optionally, an environment (`:environment`, defaulting to `"main"`); the guard verifies the current actor belongs to that space and makes the resolved tenant available to everything downstream.

```ts
import { defineTenancyModule } from "@blixis-io/tenancy";

export const { TenancyModule, TenantScopedGuard, getTenant, requireTenant } = defineTenancyModule<CurrentUser>({
  getActor: (ctx) => getCurrentUser(ctx), // however your app's auth populated RequestContext
  resolveMembership: (actor, spaceId) => membershipService.find(actor.id, spaceId),
});
```

`resolveMembership` returns `{ organizationId, role } | null | undefined` — whatever your app's own `spaces`/`users`-equivalent module looks like. `defineTenancyModule` doesn't care how that lookup works, only what it returns.

## Wiring it into a route

```ts
@Module({ imports: [TenancyModule.forRoot()], providers: [TenantScopedGuard] })
class ContentModule {}
```

```ts
@UseGuards(AuthGuard, TenantScopedGuard) // auth first — tenancy needs an actor already in context
@Controller("spaces/:spaceId/entries")
class EntriesController {
  constructor(private readonly ctx: RequestContext) {}

  @Get()
  list() {
    const tenant = requireTenant(this.ctx);
    // tenant.organizationId / tenant.spaceId / tenant.environmentId / tenant.role
  }
}
```

Same guard-ordering rule already established for [`@blixis-io/auth`](/framework/concepts/authentication/): the auth guard runs first (populates the actor), tenancy runs second (needs that actor to check membership) — both in the same `@UseGuards(...)` list.

## Fail-closed rules — adopted deliberately, not incidental

- **Unknown or inaccessible space → `404`, never `403`.** A non-member can't tell a space exists at all; `resolveMembership` returning `null`/`undefined` maps to `NotFoundException`.
- **No actor at all → `401`.** A request with no verified identity never reaches the membership check.
- **`getTenant`/`requireTenant` read lazily, from `RequestContext`, every time** — never capture the tenant at service-construction time. A provider built before the guard runs would otherwise see a stale (or empty) tenant forever; this is the same discipline `RequestContext` itself already requires elsewhere in this framework.
- **`requireTenant` throws `MissingTenantError` instead of returning `undefined`** — for code that has no sensible fallback for "no tenant" and would rather fail loudly than silently operate unscoped. Use `getTenant` instead where "maybe there's no tenant" is a legitimate case to handle.

## Scoping database queries

```ts
import { tenantColumns, tenantScope } from "@blixis-io/tenancy";
import { pgTable, text } from "drizzle-orm/pg-core";

export const entries = pgTable("entries", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  ...tenantColumns(), // organizationId, spaceId — on every tenant-scoped table, including child tables
});
```

```ts
const tenant = requireTenant(ctx);
const rows = await db.select().from(entries).where(tenantScope(entries.spaceId, tenant));
```

`tenantScope()` throws `MissingTenantError` when `tenant` is `undefined` rather than silently building a query with no `WHERE` clause at all — the same fail-closed philosophy as the guard. **Never look up a tenant-scoped row by id alone** — always go through `tenantScope()`, even for an update or delete.

For a resource already loaded another way (by id, through another module's own service — not your own scoped query), confirm it actually belongs to the current tenant before using it:

```ts
import { assertSameTenant } from "@blixis-io/tenancy";

const post = await otherModuleService.findById(id); // not tenant-scoped by construction
assertSameTenant(post.spaceId, tenant); // throws NotFoundException on mismatch — 404, not 403, same reasoning as the guard
```

## What `tenantScope()` does and doesn't do

The guard proves the caller belongs to the space in the route. `tenantScope()` builds a condition for a query. **Neither isolates anything by itself**: a query that doesn't call `tenantScope()` is not scoped, a row loaded by id alone is not checked, and a tenant column is just a column. Isolation is the pattern below, applied to every query; the helpers make the pattern hard to get wrong, not impossible.

## The pattern, for every kind of query

All of it is exercised against a real Postgres in [`isolation.test.ts`](https://github.com/blixis-io/framework/blob/main/packages/tenancy/src/isolation.test.ts); read it as the worked example.

| Operation | Do | Never |
| --- | --- | --- |
| Read | `where(and(eq(t.id, id), tenantScope(t.spaceId, tenant)))` | `where(eq(t.id, id))` |
| Update, delete | the same condition, and treat zero rows as `404` | update or delete by id alone |
| Insert | take `organizationId` and `spaceId` from `requireTenant(ctx)` | take them from the request body |
| Join | `tenantScope()` on **every** tenant-scoped table in the query, and join on the id **and** `spaceId` | scope only the table you started from |
| Row loaded by id elsewhere | `assertSameTenant(row.spaceId, tenant)` | trust it |
| Command, job, event listener | build a `TenantContext` explicitly and pass it | read the tenant from a `RequestContext` that isn't there (`requireTenant` throws, as it should) |

The id in the URL is hostile input too. A member of space A who asks for `/spaces/A/projects/<an id from space B>` must get the same `404` as for an id that doesn't exist, and a user who belongs to **both** spaces must still only get what the route's space says. An id that isn't a uuid should be a `404`, not a database error.

### Let the database back it up

A child table should not be able to point at another tenant's parent, whatever the application code does. Give the parent a unique key that includes the space, and reference that:

```sql
create table projects (
  id uuid primary key,
  space_id uuid not null,
  unique (id, space_id)
);
create table tasks (
  id uuid primary key,
  project_id uuid not null,
  space_id uuid not null,
  foreign key (project_id, space_id) references projects (id, space_id)
);
```

An insert into `tasks` with a project from another space then fails with a foreign-key violation even if the application forgot to check.

### Optional: row-level security, as a second layer

RLS makes the database refuse cross-tenant access even for a query that forgot `tenantScope()`. It is **defence in depth**, not a replacement: you still scope your queries. This recipe is tested in [`rls.test.ts`](https://github.com/blixis-io/framework/blob/main/packages/tenancy/src/rls.test.ts):

```sql
alter table projects enable row level security;
alter table projects force row level security; -- the table's owner is subject to it too
create policy tenant_isolation on projects
  using (space_id = nullif(current_setting('app.space_id', true), '')::uuid)
  with check (space_id = nullif(current_setting('app.space_id', true), '')::uuid);
```

Per request, in **one transaction**, set the tenant for that transaction only:

```ts
await client.query("begin");
await client.query("select set_config('app.space_id', $1, true)", [tenant.spaceId]); // true = this transaction only
// ... the request's queries, on this same client ...
await client.query("commit");
```

What the tests establish, and what to watch:

- With the setting, a query with **no** `WHERE` clause sees only that tenant's rows; an insert for another tenant is refused (`42501`); an update or delete of another tenant's row changes zero rows.
- **No setting means no rows**, not every row (the policy compares against null). It fails closed.
- Set it with `true` (transaction-local). With `false` the setting is session-wide and **leaks to the next request that gets the same pooled connection**; the test shows it happening.
- All of a request's queries must run on the connection that has the setting, so inside that transaction. A query on another pooled connection has no setting and sees no rows. How this fits with `@Transactional` (setting the tenant at the start of the transactional method) is reasoned, **not tested** here.
- RLS does nothing for a connection that is a **superuser or has `BYPASSRLS`** (the test shows it seeing both tenants). The application must connect as an ordinary role, and run migrations as another.
- The guard still runs first: RLS answers "which rows", not "may this user be in this space".

## Machine credentials stay in one tenant

A person can belong to several spaces; a service key should not. In `examples/saas-api` an [API key](/framework/guides/api-keys/)'s claims carry the `spaceId` it was created for, and `resolveMembership` checks that first:

```ts
resolveMembership: (actor, spaceId) =>
  actor.spaceId === undefined
    ? directory.find(actor.sub, spaceId)                    // a person: by membership
    : findForKey(directory.db, actor.spaceId, spaceId),     // a key: its own space, and nothing else
```

A key asking for another space gets the same `404` as a non-member, even holding every scope. The reference app's tests check it, including that the other space's data is not in the response.

## Testing cross-tenant isolation

Seed two organizations and spaces with distinct data, then attack every kind of operation as a member of the *other* one and assert both the response (`404`) and the database (the victim's rows unchanged). The suite linked above does this for read, update, delete, insert, joins, id substitution, a user in both spaces, malformed ids and jobs with no tenant, and includes a **control**: a deliberately unscoped route that does leak, so you can see the suite would notice. Break the code on purpose now and then (drop a `tenantScope()` from an update) and confirm a test fails; that is how the suite was checked. Build yours with [`@blixis-io/testing`](/framework/concepts/testing/)'s `Test.createModule().compile()`, a real application and real requests, no mocking the guard.

## Next

- Every exported symbol: [`@blixis-io/tenancy` reference](/framework/reference/blixis-tenancy/).
- The guard primitive this builds on: [Guards & Authorization](/framework/concepts/guards-and-authorization/).
- Where the resolved tenant lives between guards and handlers: [Request Context](/framework/concepts/request-context/).
