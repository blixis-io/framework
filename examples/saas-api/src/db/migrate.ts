import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { Database } from "./index.js";

const DIRECTORY = fileURLToPath(new URL("../../migrations/", import.meta.url));

/** An arbitrary constant: every instance that migrates takes the same lock, so two can never run at once. */
const LOCK_KEY = 7_364_221;

export interface MigrateOptions {
  /** Where the `.sql` files are. Default: this example's `migrations/`. */
  directory?: string;
  /** The schema that holds the bookkeeping table `schema_migrations`. Default `saas`. */
  schema?: string;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Applies the `.sql` files in `migrations/` that have not been applied yet, in name order, each in its own
 * transaction, and returns the names it applied. Run it as a step of the deploy (`blix run db:migrate`), **once**, before
 * the new version starts, and not from every replica at boot: the advisory lock makes a race safe, but a schema change
 * that races a running old version is the deploy's problem to order. Files are never edited after release; add a new one.
 *
 * The lock is taken before anything else, **including** creating the bookkeeping schema and table: `create schema if
 * not exists` is not safe against itself when two sessions run it at the same moment on an empty database (one fails
 * with a duplicate-key error), so the first migration of a fresh database is where the lock matters most.
 */
export async function migrate(db: Database, options: MigrateOptions = {}): Promise<string[]> {
  const directory = options.directory ?? DIRECTORY;
  const schema = options.schema ?? "saas";
  if (!IDENTIFIER.test(schema)) {
    throw new RangeError(`migrate: "${schema}" is not a plain schema name.`);
  }
  const tracking = sql.raw(`${schema}.schema_migrations`);

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
    await tx.execute(sql.raw(`create schema if not exists ${schema}`));
    await tx.execute(sql`create table if not exists ${tracking} (name text primary key, applied_at timestamptz not null default now())`);
  });

  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .toSorted();
  const applied: string[] = [];

  for (const name of files) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
      const done = await tx.execute(sql`select 1 from ${tracking} where name = ${name}`);
      if (done.rows.length > 0) {
        return;
      }
      await tx.execute(sql.raw(readFileSync(`${directory}/${name}`, "utf8")));
      await tx.execute(sql`insert into ${tracking} (name) values (${name})`);
      applied.push(name);
    });
  }
  return applied;
}
