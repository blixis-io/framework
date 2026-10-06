import { createApplication } from "@blixis-io/core";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { defineDrizzleModule } from "./module.js";

const CONNECTION = "postgres://blixis:blixis@localhost:5434/blixis";

/**
 * What the database guide says about pool settings, run against a real Postgres: the `connection` option is a `pg`
 * `PoolConfig`, so its timeouts and sizes apply as documented, and a query that hits its deadline fails without taking
 * the pool down.
 */
describe("pool settings passed through `connection`", () => {
  it("statement_timeout cancels a slow query with Postgres's own error, and the pool keeps working", async () => {
    const { DATABASE, DrizzleModule } = defineDrizzleModule({});
    const app = await createApplication(DrizzleModule.forRoot({ connection: { connectionString: CONNECTION, statement_timeout: 200 } }));
    const db = app.get(DATABASE);

    const slow = db.execute(sql`select pg_sleep(5)`);

    await expect(slow).rejects.toMatchObject({ cause: { code: "57014" } }); // query_canceled
    const after = await db.execute<{ answer: number }>(sql`select 1 as answer`);
    expect(after.rows).toEqual([{ answer: 1 }]);
    await app.close();
  });

  it("max bounds the connections, so a burst waits for a free one instead of opening more", async () => {
    const { DATABASE, DrizzleModule } = defineDrizzleModule({});
    const app = await createApplication(DrizzleModule.forRoot({ connection: { connectionString: CONNECTION, max: 2, application_name: "pool-settings-max" } }));
    const db = app.get(DATABASE);

    const queries = Array.from({ length: 6 }, () => db.execute(sql`select pg_sleep(0.15), (select count(*) from pg_stat_activity where application_name = 'pool-settings-max') as open`));
    const results = await Promise.all(queries);

    const peak = Math.max(...results.map((result) => Number(result.rows[0]?.["open"])));
    expect(peak).toBeLessThanOrEqual(2);
    await app.close();
  });

  it("connectionTimeoutMillis fails a request for a connection when the pool is exhausted, instead of waiting forever", async () => {
    const { DATABASE, DrizzleModule } = defineDrizzleModule({});
    const app = await createApplication(DrizzleModule.forRoot({ connection: { connectionString: CONNECTION, max: 1, connectionTimeoutMillis: 100 } }));
    const db = app.get(DATABASE);

    // Drizzle runs a query when it is awaited, so `.then()` is what starts each one here.
    const holder = db.execute(sql`select pg_sleep(1)`).then((result) => result);
    const waiting = db.execute(sql`select 1`).then((result) => result);

    await expect(waiting).rejects.toThrow("Failed query");
    await holder;
    await app.close();
  });
});
