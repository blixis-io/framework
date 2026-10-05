import { createApplication } from "@blixis-io/core";
import { Pool, type PoolConfig } from "pg";
import { describe, expect, it, vi } from "vitest";
import { DbConnectionError } from "../errors.js";
import { defineDrizzleModule } from "./module.js";

const TEST_CONNECTION = "postgres://blixis:blixis@localhost:5434/blixis";
/** The pool reports a lost connection asynchronously; how long to wait for that report. */
const WAIT = { timeout: 3000, interval: 25 };

/** Ends every backend whose `application_name` is `name`, the way a database restart, failover or an admin's `pg_terminate_backend` does. */
async function terminateBackends(name: string): Promise<void> {
  const admin = new Pool({ connectionString: TEST_CONNECTION, max: 1 });
  try {
    await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where application_name = $1 and pid <> pg_backend_pid()", [name]);
  } finally {
    await admin.end();
  }
}

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

describe("the pool when an idle connection is lost", () => {
  it("reports it to onPoolError instead of crashing the process, and the pool keeps working", async () => {
    const { DATABASE, DrizzleModule } = defineDrizzleModule({});
    const applicationName = `blixis-pool-error-${process.pid}-${Date.now()}`;
    const onPoolError = vi.fn<(error: Error) => void>();
    const app = await createApplication(
      DrizzleModule.forRoot({ connection: { connectionString: TEST_CONNECTION, application_name: applicationName }, onPoolError }),
    );

    // The boot-time connectivity check left one idle client in the pool; kill its backend.
    await terminateBackends(applicationName);
    await vi.waitFor(() => expect(onPoolError).toHaveBeenCalled(), WAIT);

    expect(onPoolError).toHaveBeenCalledOnce();
    expect(onPoolError.mock.calls[0]?.[0].message).toContain("terminating connection");
    // The dead client was discarded, so the next query opens a new connection.
    const result = await app.get(DATABASE).execute<{ answer: number }>("select 1 as answer");
    expect(result.rows).toEqual([{ answer: 1 }]);

    await app.close();
  });

  it("logs with console.error by default", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { DrizzleModule } = defineDrizzleModule({});
    const applicationName = `blixis-pool-default-${process.pid}-${Date.now()}`;
    const app = await createApplication(
      DrizzleModule.forRoot({ connection: { connectionString: TEST_CONNECTION, application_name: applicationName } }),
    );

    await terminateBackends(applicationName);
    await vi.waitFor(() => expect(error).toHaveBeenCalled(), WAIT);

    expect(String(error.mock.calls[0]?.[0])).toContain("[@blixis-io/db]");
    error.mockRestore();
    await app.close();
  });

  it("survives an onPoolError handler that throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { DATABASE, DrizzleModule } = defineDrizzleModule({});
    const applicationName = `blixis-pool-throwing-${process.pid}-${Date.now()}`;
    const onPoolError = vi.fn<(error: Error) => void>(() => {
      throw new Error("handler bug");
    });
    const app = await createApplication(
      DrizzleModule.forRoot({ connection: { connectionString: TEST_CONNECTION, application_name: applicationName }, onPoolError }),
    );

    await terminateBackends(applicationName);
    await vi.waitFor(() => expect(error).toHaveBeenCalled(), WAIT);

    expect(onPoolError).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0]?.[0])).toContain("onPoolError handler threw");
    expect((await app.get(DATABASE).execute("select 1")).rows).toHaveLength(1);
    error.mockRestore();
    await app.close();
  });
});

/** The options the pool behind a `DATABASE` was built with. */
async function poolOptionsOf(connection: string | PoolConfig): Promise<Pool["options"]> {
  const { DATABASE, DrizzleModule } = defineDrizzleModule({});
  const app = await createApplication(DrizzleModule.forRoot({ connection }));
  const client: unknown = Reflect.get(app.get(DATABASE), "$client");
  await app.close();
  if (!(client instanceof Pool)) {
    throw new Error("the database has no pg.Pool as $client");
  }
  return client.options;
}

describe("pool defaults", () => {
  it("waits at most 10 seconds for a connection, instead of forever", async () => {
    expect((await poolOptionsOf(TEST_CONNECTION)).connectionTimeoutMillis).toBe(10_000);
    expect((await poolOptionsOf({ connectionString: TEST_CONNECTION })).connectionTimeoutMillis).toBe(10_000);
  });

  it("keeps an explicit connectionTimeoutMillis, including 0 for no timeout", async () => {
    expect((await poolOptionsOf({ connectionString: TEST_CONNECTION, connectionTimeoutMillis: 2500 })).connectionTimeoutMillis).toBe(2500);
    expect((await poolOptionsOf({ connectionString: TEST_CONNECTION, connectionTimeoutMillis: 0 })).connectionTimeoutMillis).toBe(0);
  });

  it("leaves every other pool option as given", async () => {
    const options = await poolOptionsOf({ connectionString: TEST_CONNECTION, max: 3, idleTimeoutMillis: 1234 });
    expect(options.max).toBe(3);
    expect(options.idleTimeoutMillis).toBe(1234);
  });
});
