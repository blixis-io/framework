import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { startApp, type TestApp } from "./test-support.js";

let test: TestApp;
const run = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
const schema = `mig_${run}`; // bookkeeping and tables in a scratch schema, so none of this touches the app's own
const directories: string[] = [];

function files(contents: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "saas-migrations-"));
  directories.push(directory);
  for (const [name, text] of Object.entries(contents)) {
    writeFileSync(join(directory, name), text);
  }
  return directory;
}

beforeAll(async () => {
  test = await startApp();
});

afterAll(async () => {
  await test.app.get(DATABASE).execute(sql.raw(`drop schema if exists ${schema} cascade`));
  await test.close();
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("migrate", () => {
  it("applies the pending files in name order, and says so", async () => {
    const directory = files({
      "0002_b.sql": `create table ${schema}.b (id int primary key);`,
      "0001_a.sql": `create schema if not exists ${schema}; create table ${schema}.a (id int primary key);`,
    });

    expect(await migrate(test.app.get(DATABASE), { directory, schema })).toEqual(["0001_a.sql", "0002_b.sql"]);
  });

  it("applies nothing the second time, and only the new file after one is added", async () => {
    const directory = files({ "0001_a.sql": "select 1;", "0002_b.sql": "select 1;" });
    const db = test.app.get(DATABASE);
    await migrate(db, { directory, schema });

    expect(await migrate(db, { directory, schema })).toEqual([]);
    writeFileSync(join(directory, "0003_c.sql"), "select 1;");
    expect(await migrate(db, { directory, schema })).toEqual(["0003_c.sql"]);
  });

  it("applies each file once when several instances migrate a brand-new database at the same moment", async () => {
    const racing = `mig_race_${run}`;
    const directory = files({ "0001_first.sql": `create table ${racing}.first (id int primary key);`, "0002_second.sql": `create table ${racing}.second (id int primary key);` });
    const db = test.app.get(DATABASE);
    await db.execute(sql.raw(`drop schema if exists ${racing} cascade`));
    // The schema does not exist yet: the bookkeeping schema and table must be created under the lock too.
    // The migrations create their tables in `racing`, which the bookkeeping step makes.

    const results = await Promise.all(Array.from({ length: 6 }, () => migrate(db, { directory, schema: racing })));

    expect(results.flat().toSorted()).toEqual(["0001_first.sql", "0002_second.sql"]);
    await db.execute(sql.raw(`drop schema ${racing} cascade`));
  });

  it("rolls a failing file back whole and does not record it, so it can be fixed and run again", async () => {
    const directory = files({ "0001_broken.sql": `create table ${schema}.broken (id int primary key); select 1/0;` });
    const db = test.app.get(DATABASE);

    await expect(migrate(db, { directory, schema })).rejects.toThrow("Failed query");

    const table = await db.execute(sql`select to_regclass(${`${schema}.broken`}) as t`);
    expect(table.rows[0]).toMatchObject({ t: null });
    const recorded = await db.execute(sql.raw(`select 1 from ${schema}.schema_migrations where name = '0001_broken.sql'`));
    expect(recorded.rows).toHaveLength(0);
  });

  it("refuses a schema name that is not a plain identifier", async () => {
    await expect(migrate(test.app.get(DATABASE), { schema: "saas; drop schema public" })).rejects.toThrow("not a plain schema name");
  });
});
