import { generateApiKey } from "@blixis-io/auth";
import { Inject, Injectable } from "@blixis-io/di";
import { NotFoundException } from "@blixis-io/http";
import { tenantScope, type TenantContext } from "@blixis-io/tenancy";
import { and, desc, eq, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../db/index.js";
import { apiKeys } from "../db/schema.js";
import type { CreateApiKeyInput } from "./api-key.schema.js";

const DAY_MS = 86_400_000;

@Injectable()
export class ApiKeysService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Makes a key in the caller's space. **The returned `key` is the only copy of the secret**: only its hash is stored. */
  async create(tenant: TenantContext, createdBy: string, input: CreateApiKeyInput) {
    const made = generateApiKey();
    const expiresAt = input.expiresInDays === undefined ? null : new Date(Date.now() + input.expiresInDays * DAY_MS);
    await this.db.insert(apiKeys).values({
      id: made.id,
      secretHash: made.secretHash,
      name: input.name,
      // The tenant columns come from the guard's tenant, never from the request body.
      organizationId: tenant.organizationId,
      spaceId: tenant.spaceId,
      createdBy,
      scopes: input.scopes,
      allowedCidrs: input.allowedCidrs,
      expiresAt,
    });
    return { id: made.id, key: made.key, name: input.name, scopes: input.scopes, allowedCidrs: input.allowedCidrs, expiresAt };
  }

  /** Never returns the hash or the key: there is nothing left to show after creation. */
  list(tenant: TenantContext) {
    return this.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        scopes: apiKeys.scopes,
        allowedCidrs: apiKeys.allowedCidrs,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(tenantScope(apiKeys.spaceId, tenant))
      .orderBy(desc(apiKeys.createdAt));
  }

  /** Refuses the key from now on (404 for a key of another space). Revoking twice keeps the first time. */
  async revoke(tenant: TenantContext, id: string): Promise<void> {
    const found = await this.db
      .update(apiKeys)
      .set({ revokedAt: sql`coalesce(${apiKeys.revokedAt}, now())` })
      .where(and(eq(apiKeys.id, id), tenantScope(apiKeys.spaceId, tenant)))
      .returning({ id: apiKeys.id });
    if (found.length === 0) {
      throw new NotFoundException();
    }
  }
}
