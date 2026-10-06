import type { NewRefreshToken, RefreshTokenRecord, RefreshTokenStore } from "@blixis-io/auth";
import { Inject, Injectable } from "@blixis-io/di";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database } from "../db/index.js";
import { refreshTokens } from "../db/schema.js";

/**
 * The reference store from the auth docs, over Drizzle: `rotate()` marks the old token and stores the successor in one
 * transaction (a failure leaves the old token usable), the `where rotated_at is null` is the compare-and-set that gives
 * two simultaneous refreshes exactly one winner, and families let a replayed token end one login, not every device.
 */
@Injectable()
export class DrizzleRefreshTokenStore implements RefreshTokenStore {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(tokenHash: string, record: NewRefreshToken): Promise<void> {
    await this.db.insert(refreshTokens).values({ tokenHash, subject: record.subject, familyId: record.familyId, expiresAt: record.expiresAt });
  }

  async find(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const [row] = await this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash));
    return row ? { subject: row.subject, familyId: row.familyId, expiresAt: row.expiresAt, rotatedAt: row.rotatedAt, revokedAt: row.revokedAt } : null;
  }

  async markRotated(tokenHash: string): Promise<boolean> {
    const updated = await this.db
      .update(refreshTokens)
      .set({ rotatedAt: new Date() })
      .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.rotatedAt), isNull(refreshTokens.revokedAt)))
      .returning({ tokenHash: refreshTokens.tokenHash });
    return updated.length === 1;
  }

  async rotate(oldTokenHash: string, next: NewRefreshToken & { tokenHash: string }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const marked = await tx
        .update(refreshTokens)
        .set({ rotatedAt: new Date() })
        .where(and(eq(refreshTokens.tokenHash, oldTokenHash), isNull(refreshTokens.rotatedAt), isNull(refreshTokens.revokedAt)))
        .returning({ tokenHash: refreshTokens.tokenHash });
      if (marked.length !== 1) {
        return false;
      }
      await tx.insert(refreshTokens).values({ tokenHash: next.tokenHash, subject: next.subject, familyId: next.familyId, expiresAt: next.expiresAt });
      return true;
    });
  }

  async revoke(tokenHash: string): Promise<void> {
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)));
  }

  async revokeAllForSubject(subject: string): Promise<void> {
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.subject, subject), isNull(refreshTokens.revokedAt)));
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }
}
