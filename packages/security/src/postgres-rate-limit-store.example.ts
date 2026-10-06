import type { Pool } from "pg";
import type { RateLimitHit, RateLimitStore } from "./rate-limit.js";

/**
 * A shared `RateLimitStore` for Postgres, the one the security docs show. It is not exported from the package
 * (`@blixis-io/security` has no database dependency): copy it into your app. The tests run it against a real database.
 *
 * ```sql
 * create table rate_limits (
 *   key text primary key,
 *   count integer not null,
 *   reset_at timestamptz not null
 * );
 * ```
 *
 * One statement does the whole job, so it is atomic across replicas: the row is created, or counted, or restarted
 * when its window has ended, under the row lock Postgres already takes. Two replicas hitting one key at the same
 * instant get different counts. Window times use the database clock, so replicas with drifting clocks still agree.
 * Delete rows with `reset_at < now()` from a scheduled job; they are only kept until the next hit on that key.
 */
export class PostgresRateLimitStore implements RateLimitStore {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const { rows } = await this.pool.query<{ count: number; reset_ms: string }>(
      `insert into rate_limits (key, count, reset_at)
       values ($1, 1, now() + $2 * interval '1 millisecond')
       on conflict (key) do update set
         count = case when rate_limits.reset_at <= now() then 1 else rate_limits.count + 1 end,
         reset_at = case when rate_limits.reset_at <= now() then now() + $2 * interval '1 millisecond' else rate_limits.reset_at end
       returning count, (extract(epoch from reset_at) * 1000)::bigint as reset_ms`,
      [key, windowMs],
    );
    const row = rows[0];
    if (!row) {
      throw new Error("the rate-limit upsert returned no row");
    }
    return { count: row.count, resetAt: Number(row.reset_ms) };
  }
}
