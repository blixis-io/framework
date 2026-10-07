import type { ApiKeyRecord, ApiKeyStore } from "@blixis-io/auth";
import { Inject, Injectable } from "@blixis-io/di";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../db/index.js";
import { apiKeys } from "../db/schema.js";
import type { Claims } from "../auth/auth.js";

/**
 * Where the guard looks keys up. The claims a key acts as are built here, from the row: a service named after the key,
 * confined to the key's space (`spaceId`), never copied from anything a caller sent.
 */
@Injectable()
export class DrizzleApiKeyStore implements ApiKeyStore {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async find(id: string): Promise<ApiKeyRecord | undefined> {
    const [row] = await this.db.select().from(apiKeys).where(eq(apiKeys.id, id));
    if (!row) {
      return undefined;
    }
    const claims: Claims = { sub: `apikey:${row.id}`, email: `apikey:${row.id}`, spaceId: row.spaceId };
    return {
      id: row.id,
      secretHash: row.secretHash,
      claims,
      scopes: row.scopes,
      allowedCidrs: row.allowedCidrs,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    };
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.db.update(apiKeys).set({ lastUsedAt: at }).where(eq(apiKeys.id, id));
  }
}
