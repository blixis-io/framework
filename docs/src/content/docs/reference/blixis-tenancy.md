---
title: "@blixis-io/tenancy"
description: Full API reference for the tenancy package.
sidebar:
  order: 12
---

Request-scoped multi-tenant access control. See [Tenancy](/concepts/tenancy/) for the concepts and the fail-closed rules behind every method here.

## `defineTenancyModule`

```ts
function defineTenancyModule<Actor>(options: TenancyModuleOptions<Actor>): {
  TenancyModule: { forRoot(options?: TenancyForRootOptions): DynamicModule };
  TenantScopedGuard: Class<CanActivate>;
  getTenant(ctx: RequestContext): TenantContext | undefined;
  requireTenant(ctx: RequestContext): TenantContext;
  assertSameTenant(resourceSpaceId: string, tenant: TenantContext): void;
};

interface TenancyModuleOptions<Actor> {
  getActor: (ctx: RequestContext) => Actor | undefined;
  resolveMembership: (
    actor: Actor,
    spaceId: string,
  ) => Membership | null | undefined | Promise<Membership | null | undefined>;
}

interface Membership {
  organizationId: string;
  role: string;
}
```

Same factory-closure shape as [`@blixis-io/config`'s `defineConfigModule`](/reference/blixis-config/) and [`@blixis-io/auth`'s `defineAuthModule`](/reference/blixis-auth/) — call it once per app (typically in its own `tenancy.ts`), export the result. `getActor` and `resolveMembership` are the only two integration points: this package never assumes which auth mechanism populated the actor, or how memberships are stored.

## `TenantContext`

```ts
interface TenantContext {
  organizationId: string;
  spaceId: string;
  environmentId: string; // defaults to "main" when the route has no :environment param
  role: string;
}
```

## `TenancyModule.forRoot(options?)`

```ts
interface TenancyForRootOptions {
  global?: boolean; // default false
}
```

```ts
@Module({ imports: [TenancyModule.forRoot()], providers: [TenantScopedGuard] })
class ContentModule {}
```

Registers `TenantScopedGuard`. `global` defaults to `false` — most apps only need it in the modules that actually have tenant-scoped routes.

## `TenantScopedGuard`

```ts
@UseGuards(AuthGuard, TenantScopedGuard) // auth guard first — tenancy needs an actor already in context
@Controller("spaces/:spaceId/entries")
class EntriesController {}
```

Reads `:spaceId` (and `:environment`, if present) from the matched route. No actor in context → `UnauthorizedException`. `resolveMembership` returns `null`/`undefined` → `NotFoundException` (never `403` — a non-member can't tell the space exists). On success, stores the resolved `TenantContext` and returns `true`. Throws a plain `Error` if applied to a route with no `:spaceId` param at all — a routing mistake, not a runtime access decision.

## `getTenant(ctx)` / `requireTenant(ctx)`

```ts
function getTenant(ctx: RequestContext): TenantContext | undefined;
function requireTenant(ctx: RequestContext): TenantContext; // throws MissingTenantError instead of returning undefined
```

Both read from `RequestContext` fresh on every call — never cache the result at service-construction time (a provider can be built before the guard has run). Use `getTenant` where "no tenant" is a legitimate case to handle; `requireTenant` where it isn't.

## `assertSameTenant(resourceSpaceId, tenant)`

```ts
function assertSameTenant(resourceSpaceId: string, tenant: TenantContext): void; // throws NotFoundException on mismatch
```

For a resource loaded another way — by id, through another module's own service, not your own tenant-scoped query. Also available as a standalone import (`import { assertSameTenant } from "@blixis-io/tenancy"`), independent of any specific `defineTenancyModule()` call, since it only compares two plain values.

## `MissingTenantError`

```ts
class MissingTenantError extends Error {}
```

Thrown by `requireTenant()` and `tenantScope()` when there's no tenant in the current request context — the shared fail-closed signal both use instead of silently operating unscoped.

## `tenantScope(spaceIdColumn, tenant)` / `tenantColumns()`

```ts
function tenantScope(spaceIdColumn: PgColumn, tenant: TenantContext | undefined): SQL; // throws MissingTenantError if tenant is undefined
function tenantColumns(): { organizationId: PgColumnBuilder; spaceId: PgColumnBuilder };
```

Plain [Drizzle](https://orm.drizzle.team) helpers — no dependency on `@blixis-io/db`, just `drizzle-orm` directly, so this package stays usable regardless of which database package (or none) an app uses.

```ts
export const entries = pgTable("entries", {
  id: text("id").primaryKey(),
  ...tenantColumns(),
});

const rows = await db.select().from(entries).where(tenantScope(entries.spaceId, requireTenant(ctx)));
```

Compose `tenantScope()` with other conditions via Drizzle's own `and()` — it returns one predicate, not a full query.
