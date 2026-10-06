import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { startApp, type TestApp } from "./test-support.js";

let test: TestApp;
let directory: string;
const run = crypto.randomUUID().replaceAll("-", "");

beforeAll(async () => {
  test = await startApp();
  directory = mkdtempSync(join(tmpdir(), "saas-migrations-"));
  writeFileSync(join(directory, `${run}_0001_a.sql`), `create table saas.mig_a_${run} (id int primary key);`);
  writeFileSync(join(directory, `${run}_0002_b.sql`), `create table saas.mig_b_${run} (id int primary key);`);
});

afterAll(async () => {
  const db = test.app.get(DATABASE);
  await db.execute(sql.raw(`drop table if exists saas.mig_a_${run}, saas.mig_b_${run}`));
  await db.execute(sql`delete from saas.schema_migrations where name like ${`${run}%`}`);
  await test.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("migrate", () => {
  it("applies the pending files in name order, and says so", async () => {
    const applied = await migrate(test.app.get(DATABASE), directory);

    expect(applied).toEqual([`${run}_0001_a.sql`, `${run}_0002_b.sql`]);
  });

  it("applies nothing the second time", async () => {
    expect(await migrate(test.app.get(DATABASE), directory)).toEqual([]);
  });

  it("applies each file once when several instances migrate at the same moment", async () => {
    const racing = mkdtempSync(join(tmpdir(), "saas-migrations-race-"));
    const name = `${run}_0100_race.sql`;
    writeFileSync(join(racing, name), `create table saas.mig_race_${run} (id int primary key);`);
    const db = test.app.get(DATABASE);

    const results = await Promise.all(Array.from({ length: 5 }, () => migrate(db, racing)));

    expect(results.flat()).toEqual([name]);
    await db.execute(sql.raw(`drop table saas.mig_race_${run}`));
    rmSync(racing, { recursive: true, force: true });
  });

  it("rolls a failing file back whole and does not record it, so it can be fixed and run again", async () => {
    const broken = mkdtempSync(join(tmpdir(), "saas-migrations-broken-"));
    const name = `${run}_0200_broken.sql`;
    writeFileSync(join(broken, name), `create table saas.mig_broken_${run} (id int primary key); select 1/0;`);
    const db = test.app.get(DATABASE);

    await expect(migrate(db, broken)).rejects.toThrow("Failed query");

    const table = await db.execute(sql`select to_regclass(${`saas.mig_broken_${run}`}) as t`);
    expect(table.rows[0]).toMatchObject({ t: null });
    const recorded = await db.execute(sql`select 1 from saas.schema_migrations where name = ${name}`);
    expect(recorded.rows).toHaveLength(0);
    rmSync(broken, { recursive: true, force: true });
  });
});
