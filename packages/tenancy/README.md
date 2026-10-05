# `@blixis-io/tenancy`

Request-scoped multi-tenant access control (`TenantScopedGuard`, a fail-closed `tenantScope()` query helper). Mechanism only — no Organization/Space/Membership data model — reusable by any multi-tenant app.

```bash
npm install @blixis-io/tenancy @blixis-io/http @blixis-io/core @blixis-io/di zod drizzle-orm
```

```ts
import { defineTenancyModule } from "@blixis-io/tenancy";

export const { TenancyModule, TenantScopedGuard, getTenant, requireTenant } = defineTenancyModule({
  getActor: (ctx) => getCurrentUser(ctx),
  resolveMembership: (actor, spaceId) => membershipService.find(actor.id, spaceId),
});
```

```ts
@UseGuards(AuthGuard, TenantScopedGuard)
@Controller("spaces/:spaceId/entries")
class EntriesController {}
```

Fail-closed by design: an unknown or inaccessible space returns `404`, never `403` — a non-member can't tell a space exists at all.

Part of [Blixis Framework](https://github.com/blixis-io/framework) — full docs: [Tenancy](https://blixis-io.github.io/framework/concepts/tenancy/) · [API reference](https://blixis-io.github.io/framework/reference/blixis-tenancy/).
