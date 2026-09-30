import { eq, type SQL } from "drizzle-orm";
import { uuid, type PgColumn } from "drizzle-orm/pg-core";
import { MissingTenantError } from "./errors.js";
import type { TenantContext } from "./module.js";

/**
 * A `where` predicate scoping a query to `tenant`'s space — throws
 * `MissingTenantError` instead of silently returning an unscoped query
 * when `tenant` is `undefined`. Compose with other conditions via
 * Drizzle's own `and(tenantScope(posts.spaceId, tenant), ...)`.
 */
export function tenantScope(spaceIdColumn: PgColumn, tenant: TenantContext | undefined): SQL {
  if (!tenant) {
    throw new MissingTenantError();
  }
  return eq(spaceIdColumn, tenant.spaceId);
}

/** Spread into an app's own `pgTable()` definition — `organizationId`/`spaceId` columns, present on every tenant-scoped table, including child tables (no join needed to scope a query). */
export function tenantColumns() {
  return {
    organizationId: uuid("organization_id").notNull(),
    spaceId: uuid("space_id").notNull(),
  };
}
