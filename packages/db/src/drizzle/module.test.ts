import { createApplication } from "@blixis/core";
import { describe, expect, it } from "vitest";
import { DbConnectionError } from "../errors.js";
import { defineDrizzleModule } from "./module.js";

const TEST_CONNECTION = "postgres://blixis:blixis@localhost:5434/blixis";

describe("defineDrizzleModule", () => {
  it("forRoot() connects and provides a working DATABASE", async () => {
    const { DATABASE, DrizzleModule } = defineDrizzleModule({});

    const app = await createApplication(DrizzleModule.forRoot({ connection: TEST_CONNECTION }));
    const db = app.get(DATABASE);

    const result = await db.execute<{ answer: number }>("select 1 as answer");
    expect(result.rows).toEqual([{ answer: 1 }]);

    await app.close();
  });

  it("close() ends the pool, so a query made afterwards rejects", async () => {
    const { DATABASE, DrizzleModule } = defineDrizzleModule({});

    const app = await createApplication(DrizzleModule.forRoot({ connection: TEST_CONNECTION }));
    const db = app.get(DATABASE);
    await app.close();

    await expect(db.execute("select 1")).rejects.toThrow("Failed query: select 1");
  });

  it("rejects at boot with DbConnectionError when the initial connectivity check fails", async () => {
    const { DrizzleModule } = defineDrizzleModule({});

    await expect(
      createApplication(
        DrizzleModule.forRoot({ connection: { host: "localhost", port: 5999, connectionTimeoutMillis: 200 } }),
      ),
    ).rejects.toThrow(DbConnectionError);
  });

  it("defaults to a non-global module", () => {
    const { DrizzleModule } = defineDrizzleModule({});

    const dynamic = DrizzleModule.forRoot({ connection: TEST_CONNECTION });

    expect(dynamic.global).toBe(false);
  });

  it("global: true makes DATABASE visible without a direct import", () => {
    const { DrizzleModule } = defineDrizzleModule({});

    const dynamic = DrizzleModule.forRoot({ connection: TEST_CONNECTION, global: true });

    expect(dynamic.global).toBe(true);
  });

  it("each call to defineDrizzleModule produces its own distinct token, even for the same schema", () => {
    const schema = {};
    const a = defineDrizzleModule(schema);
    const b = defineDrizzleModule(schema);

    expect(a.DATABASE).not.toBe(b.DATABASE);
  });
});
