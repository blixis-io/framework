import { defineTenancyModule, type Membership } from "@blixis-io/tenancy";
import { and, eq } from "drizzle-orm";
import { getCurrentUser, type Claims } from "../auth/auth.js";
import type { Database } from "../db/index.js";
import { memberships } from "../db/schema.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How the tenancy guard learns who belongs to which space. `defineTenancyModule` wants a plain function, defined once
 * at module scope, while the database only exists once the application has booted, so a small holder is filled in by
 * `MembershipDirectoryWiring` when it does. One application per process (the real case); tests create one at a time.
 */
export class MembershipDirectory {
  db: Database | undefined;

  async find(userId: string, spaceId: string): Promise<Membership | null> {
    // Not a uuid is "no such space", not a database error: the cast to uuid would throw for it.
    if (!this.db || !UUID.test(spaceId)) {
      return null;
    }
    const [row] = await this.db
      .select({ organizationId: memberships.organizationId, role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.spaceId, spaceId)));
    return row ?? null;
  }
}

export const directory = new MembershipDirectory();

export const { TenancyModule, TenantScopedGuard, requireTenant } = defineTenancyModule<Claims>({
  getActor: (ctx) => getCurrentUser(ctx),
  resolveMembership: (actor, spaceId) => directory.find(actor.sub, spaceId),
});
