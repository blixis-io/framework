import { Inject, Injectable } from "@blixis-io/di";
import { tenantScope, type TenantContext } from "@blixis-io/tenancy";
import { desc } from "drizzle-orm";
import { DATABASE, type Database } from "../db/index.js";
import { activity } from "../db/schema.js";

/** What the outbox consumer wrote, read back under the same tenant rule as everything else. */
@Injectable()
export class ActivityService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  list(tenant: TenantContext) {
    return this.db.select().from(activity).where(tenantScope(activity.spaceId, tenant)).orderBy(desc(activity.createdAt)).limit(50);
  }
}
