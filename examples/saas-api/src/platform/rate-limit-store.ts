import type { RateLimitHit, RateLimitStore } from "@blixis-io/security";
import { sql } from "drizzle-orm";
import type { Database } from "../db/index.js";

/**
 * The rate-limit counters, in the application's own database so every replica shares them: one limit across all of
 * them, not the limit times the number of replicas. One upsert, so two replicas hitting a key at once get different counts.
 * Takes a function because the middleware is built before the application, and the database exists only after it boots.
 */
export class DrizzleRateLimitStore implements RateLimitStore {
  constructor(private readonly database: () => Database) {}

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const result = await this.database().execute<{ count: number; reset_ms: string }>(sql`
      insert into saas.rate_limits (key, count, reset_at)
      values (${key}, 1, now() + ${windowMs} * interval '1 millisecond')
      on conflict (key) do update set
        count = case when saas.rate_limits.reset_at <= now() then 1 else saas.rate_limits.count + 1 end,
        reset_at = case when saas.rate_limits.reset_at <= now() then now() + ${windowMs} * interval '1 millisecond' else saas.rate_limits.reset_at end
      returning count, (extract(epoch from reset_at) * 1000)::bigint as reset_ms`);
    const row = result.rows[0];
    if (!row) {
      throw new Error("the rate-limit upsert returned no row");
    }
    return { count: row.count, resetAt: Number(row.reset_ms) };
  }
}
