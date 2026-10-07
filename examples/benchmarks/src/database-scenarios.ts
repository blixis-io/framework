import { Module } from "@blixis-io/core";
import { defineDrizzleModule } from "@blixis-io/db";
import { Inject } from "@blixis-io/di";
import { Body, Controller, createHttpApplication, Get, HttpCode, NotFoundException, Param, Post, Returns } from "@blixis-io/http";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { bigserial, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { z } from "zod";
import type { Running } from "./scenarios.js";

/**
 * The workloads that talk to Postgres. Everything the other workloads leave out is here: a pooled connection, a query
 * plan, a round trip and (for the write) a commit. They live in their own schema, `blixis_bench`, which is created and
 * filled the first time and left in place, so the benchmark can be run again without waiting for it.
 */

export const DATABASE_SCENARIOS = ["database-read", "database-write"] as const;
export type DatabaseScenario = (typeof DATABASE_SCENARIOS)[number];

export const DATABASE_DESCRIPTIONS: Record<DatabaseScenario, string> = {
  "database-read": "a primary-key lookup in a 10,000-row table through the pool, a different row each request (routing, one query, one JSON row back)",
  "database-write": "POST a small JSON body and insert it with `returning` (routing, body validation, one INSERT and its commit)",
};

export const DATABASE_URL = process.env["BENCH_DATABASE_URL"] ?? process.env["DATABASE_URL"] ?? "postgres://blixis:blixis@localhost:5434/blixis";
const ROWS = 10_000;

const bench = pgSchema("blixis_bench");
const items = bench.table("items", { id: integer("id").primaryKey(), name: text("name").notNull(), payload: jsonb("payload").notNull() });
const writes = bench.table("writes", { id: bigserial("id", { mode: "number" }).primaryKey(), name: text("name").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow() });
const schema = { items, writes };

const { DATABASE, DrizzleModule } = defineDrizzleModule(schema);
type Database = NodePgDatabase<typeof schema>;

const ItemSchema = z.object({ id: z.number(), name: z.string(), payload: z.unknown() });
const CreateSchema = z.object({ name: z.string().min(1).max(100) });
const CreatedSchema = z.object({ id: z.number(), name: z.string(), createdAt: z.date() });

@Controller("items")
class ItemsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get(":id")
  @Returns(ItemSchema)
  async get(@Param("id") id: string) {
    // Any number names a row, so the load generator can send an ever-changing id without knowing how many rows there are.
    const rowId = (Math.abs(Math.trunc(Number(id))) % ROWS) + 1;
    const [row] = await this.db.select().from(items).where(eq(items.id, rowId));
    if (!row) {
      throw new NotFoundException();
    }
    return row;
  }

  @Post()
  @HttpCode(201)
  @Returns(CreatedSchema)
  async create(@Body(CreateSchema) body: z.infer<typeof CreateSchema>) {
    const [row] = await this.db.insert(writes).values({ name: body.name }).returning();
    return row;
  }
}

/** Is there a database to measure? Resolves with the reason when there is not, so the benchmark can say why it skipped. */
export async function databaseUnavailable(): Promise<string | undefined> {
  const pool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2_000, max: 1 });
  try {
    await pool.query("select 1");
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await pool.end();
  }
}

/** Creates the schema and tables if they are missing and fills `items`. Idempotent, and safe if two processes do it at once. */
async function prepare(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(7364222)");
      await client.query("create schema if not exists blixis_bench");
      await client.query("create table if not exists blixis_bench.items (id integer primary key, name text not null, payload jsonb not null)");
      await client.query("create table if not exists blixis_bench.writes (id bigserial primary key, name text not null, created_at timestamptz not null default now())");
      // Filled once; every later start (the cold-start runs among them) finds it full and skips the insert.
      const { rows } = await client.query<{ n: string }>("select count(*) as n from blixis_bench.items");
      if (Number(rows[0]?.n) !== ROWS) {
        await client.query(
          `insert into blixis_bench.items select g, 'item-' || g, jsonb_build_object('n', g, 'tags', jsonb_build_array('a', 'b', 'c')) from generate_series(1, ${ROWS}) g on conflict (id) do nothing`,
        );
      }
      await client.query("truncate blixis_bench.writes");
      await client.query("commit");
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

export async function startDatabaseScenario(scenario: DatabaseScenario): Promise<Running> {
  await prepare();
  @Module({ imports: [DrizzleModule.forRoot({ connection: { connectionString: DATABASE_URL, max: 10 } })], controllers: [ItemsController] })
  class DatabaseModule {}

  const app = await createHttpApplication(DatabaseModule);
  const { port } = await app.listen(0, "127.0.0.1");
  const request: Running["request"] =
    scenario === "database-read"
      ? { method: "GET", path: "/items/[<id>]", varyId: true }
      : { method: "POST", path: "/items", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "benchmark" }) };
  return { port, request, close: () => app.close() };
}
