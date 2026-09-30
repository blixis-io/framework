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

Same guard-ordering rule already established for [`@blixis-io/auth`](/concepts/authentication/): the auth guard runs first (populates the actor), tenancy runs second (needs that actor to check membership) — both in the same `@UseGuards(...)` list.

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

## Testing cross-tenant isolation

This package doesn't ship a test harness — it needs real tenant-scoped routes to test against, which don't exist until you've built some. The recipe, once you have: seed two organizations/spaces with distinct data, then replay every tenant-scoped route as a member of the *other* organization and assert every one returns `404`/`403` with the victim's data unchanged. Build it with [`@blixis-io/testing`](/concepts/testing/)'s `Test.createModule().compile()` — a real application, real requests, no mocking the guard itself. Worth doing as soon as you have two or three real routes, not deferred until many exist.

## Next

- Every exported symbol: [`@blixis-io/tenancy` reference](/reference/blixis-tenancy/).
- The guard primitive this builds on: [Guards & Authorization](/concepts/guards-and-authorization/).
- Where the resolved tenant lives between guards and handlers: [Request Context](/concepts/request-context/).
