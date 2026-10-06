import { Inject, Injectable, InjectionToken } from "@blixis-io/di";
import type { Pool } from "pg";
import type { NewRefreshToken, RefreshTokenRecord, RefreshTokenStore } from "./issuing.js";

/**
 * A reference `RefreshTokenStore` for Postgres, the one the auth docs show. It is not exported from the package
 * (`@blixis-io/auth` has no database dependency): copy it into your app. `auth.test` runs it against a real database.
 *
 * ```sql
 * create table refresh_tokens (
 *   token_hash text primary key,
 *   subject text not null,
 *   family_id uuid not null,
 *   expires_at timestamptz not null,
 *   rotated_at timestamptz,
 *   revoked_at timestamptz
 * );
 * create index refresh_tokens_subject on refresh_tokens (subject);
 * create index refresh_tokens_family on refresh_tokens (family_id);
 * ```
 *
 * `rotate()` makes rotation one transaction, so a failure never leaves a client with no valid token; the
 * `update ... where rotated_at is null` is the compare-and-set that makes two simultaneous refreshes of one token
 * produce exactly one winner. Timestamps use the database's clock. Delete rows past `expires_at` with a scheduled job.
 */
export const PG_POOL = new InjectionToken<PoolLike>("pg-pool");

/** What the store uses of a `pg` `Pool`. */
export type PoolLike = Pick<Pool, "query" | "connect">;

interface Row {
  subject: string;
  family_id: string;
  expires_at: Date;
  rotated_at: Date | null;
  revoked_at: Date | null;
}

@Injectable()
export class PostgresRefreshTokenStore implements RefreshTokenStore {
  constructor(@Inject(PG_POOL) private readonly pool: PoolLike) {}

  async create(tokenHash: string, record: NewRefreshToken): Promise<void> {
    await this.pool.query("insert into refresh_tokens (token_hash, subject, family_id, expires_at) values ($1, $2, $3, $4)", [
      tokenHash,
      record.subject,
      record.familyId,
      record.expiresAt,
    ]);
  }

  async find(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const { rows } = await this.pool.query<Row>("select subject, family_id, expires_at, rotated_at, revoked_at from refresh_tokens where token_hash = $1", [tokenHash]);
    const row = rows[0];
    return row ? { subject: row.subject, familyId: row.family_id, expiresAt: row.expires_at, rotatedAt: row.rotated_at, revokedAt: row.revoked_at } : null;
  }

  async markRotated(tokenHash: string): Promise<boolean> {
    const result = await this.pool.query("update refresh_tokens set rotated_at = now() where token_hash = $1 and rotated_at is null and revoked_at is null", [tokenHash]);
    return result.rowCount === 1;
  }

  async rotate(oldTokenHash: string, next: NewRefreshToken & { tokenHash: string }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const marked = await client.query("update refresh_tokens set rotated_at = now() where token_hash = $1 and rotated_at is null and revoked_at is null", [oldTokenHash]);
      if (marked.rowCount !== 1) {
        await client.query("rollback");
        return false;
      }
      await client.query("insert into refresh_tokens (token_hash, subject, family_id, expires_at) values ($1, $2, $3, $4)", [
        next.tokenHash,
        next.subject,
        next.familyId,
        next.expiresAt,
      ]);
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async revoke(tokenHash: string): Promise<void> {
    await this.pool.query("update refresh_tokens set revoked_at = coalesce(revoked_at, now()) where token_hash = $1", [tokenHash]);
  }

  async revokeAllForSubject(subject: string): Promise<void> {
    await this.pool.query("update refresh_tokens set revoked_at = coalesce(revoked_at, now()) where subject = $1", [subject]);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.pool.query("update refresh_tokens set revoked_at = coalesce(revoked_at, now()) where family_id = $1", [familyId]);
  }
}
