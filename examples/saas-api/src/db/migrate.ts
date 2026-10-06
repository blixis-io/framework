import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { Database } from "./index.js";

const DIRECTORY = fileURLToPath(new URL("../../migrations/", import.meta.url));

/** An arbitrary constant: every instance that migrates takes the same lock, so two can never run at once. */
const LOCK_KEY = 7_364_221;

/**
 * Applies the `.sql` files in `migrations/` that have not been applied yet, in name order, each in its own
 * transaction, and returns the names it applied. Run it as a step of the deploy (`blix run db:migrate`), **once**, before
 * the new version starts, and not from every replica at boot: the advisory lock makes a race safe, but a schema change
 * that races a running old version is the deploy's problem to order. Files are never edited after release; add a new one.
 */
export async function migrate(db: Database, directory: string = DIRECTORY): Promise<string[]> {
  await db.execute(sql`create schema if not exists saas`);
  await db.execute(sql`create table if not exists saas.schema_migrations (name text primary key, applied_at timestamptz not null default now())`);

  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .toSorted();
  const applied: string[] = [];

  for (const name of files) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
      const done = await tx.execute(sql`select 1 from saas.schema_migrations where name = ${name}`);
      if (done.rows.length > 0) {
        return;
      }
      await tx.execute(sql.raw(readFileSync(`${directory}/${name}`, "utf8")));
      await tx.execute(sql`insert into saas.schema_migrations (name) values (${name})`);
      applied.push(name);
    });
  }
  return applied;
}
