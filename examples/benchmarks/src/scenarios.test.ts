import { Pool, type QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DATABASE_SCENARIOS, DATABASE_URL, startDatabaseScenario, type DatabaseScenario } from "./database-scenarios.js";
import { SCENARIOS, startScenario, type Running, type Scenario } from "./scenarios.js";

/**
 * A benchmark that measures an error page, or a route that quietly does less than it says, produces a confident wrong
 * number. So each workload is checked to answer what its description claims, with the exact request the benchmark sends.
 */

async function send(running: Running, overrides: { headers?: Record<string, string | undefined> } = {}): Promise<Response> {
  const headers: Record<string, string> = { ...running.request.headers };
  for (const [name, value] of Object.entries(overrides.headers ?? {})) {
    if (value === undefined) {
      delete headers[name];
    } else {
      headers[name] = value;
    }
  }
  // `[<id>]` is what the runner replaces with a different whole number each request; here it is just 1.
  return fetch(`http://127.0.0.1:${running.port}${running.request.path.replace("[<id>]", "1")}`, {
    method: running.request.method,
    headers,
    ...(running.request.body === undefined ? {} : { body: running.request.body }),
  });
}

const isDatabase = (scenario: Scenario | DatabaseScenario): scenario is DatabaseScenario => DATABASE_SCENARIOS.some((name) => name === scenario);

async function withScenario<T>(scenario: Scenario | DatabaseScenario, use: (running: Running) => Promise<T>): Promise<T> {
  const running = isDatabase(scenario) ? await startDatabaseScenario(scenario) : await startScenario(scenario);
  try {
    return await use(running);
  } finally {
    await running.close();
  }
}

describe("every workload answers what it claims, to the request the benchmark sends", () => {
  it.each(SCENARIOS)("%s answers 200 with JSON", async (scenario) => {
    await withScenario(scenario, async (running) => {
      const response = await send(running);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toBeTypeOf("object");
    });
  });

  it("validated validates the body and the response: the same object comes back, and a bad body is refused", async () => {
    await withScenario("validated", async (running) => {
      const ok = await send(running);
      const bad = await fetch(`http://127.0.0.1:${running.port}/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "", tags: [], count: 1.5 }) });

      expect(await ok.json()).toEqual({ name: "benchmark", tags: ["a", "b", "c"], count: 42 });
      expect(bad.status).toBe(400);
    });
  });

  it("authenticated really checks the token: without it, or with a bad one, the same route answers 401", async () => {
    await withScenario("authenticated", async (running) => {
      expect((await send(running, { headers: { authorization: undefined } })).status).toBe(401);
      expect((await send(running, { headers: { authorization: "Bearer not.a.token" } })).status).toBe(401);
      expect((await send(running)).status).toBe(200);
    });
  });

  it("middleware really runs the stack: CORS, security headers and the rate limit are on the response", async () => {
    await withScenario("middleware", async (running) => {
      const response = await send(running);

      expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("ratelimit-limit")).toBeTruthy();
    });
  });
});

const CreatedRow = z.object({ id: z.number(), name: z.string() });

async function query<T extends QueryResultRow>(sql: string): Promise<T[]> {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    return (await pool.query<T>(sql)).rows;
  } finally {
    await pool.end();
  }
}

// These need Postgres (the compose database on :5434, as in CI). They are not skipped when it is missing: a benchmark
// that quietly stops measuring the database is how a workload ends up claiming something it no longer does.
describe("the database workloads do what they claim, against a real Postgres", () => {
  it("database-read reads the row its id names, and any number names a row", async () => {
    await withScenario("database-read", async (running) => {
      const row = async (id: number) => (await fetch(`http://127.0.0.1:${running.port}/items/${id}`)).json();

      expect(await row(41)).toEqual({ id: 42, name: "item-42", payload: { n: 42, tags: ["a", "b", "c"] } });
      expect(await row(6)).toMatchObject({ id: 7, name: "item-7" }); // another row: it is not always the same one
      expect(await row(9999)).toMatchObject({ id: 10_000 }); // the last row
      expect(await row(10_041)).toMatchObject({ id: 42 }); // wraps around
      expect(await row(-41)).toMatchObject({ id: 42 }); // a negative number still names a row
    });
  });

  it("database-read sends a request whose id the runner changes, and the benchmark's own request succeeds", async () => {
    await withScenario("database-read", async (running) => {
      expect(running.request.path).toBe("/items/[<id>]");
      expect(running.request.varyId).toBe(true);
      expect((await send(running)).status).toBe(200);
    });
  });

  it("database-write really inserts: each request adds a row, with a new id, and a bad body is refused", async () => {
    await withScenario("database-write", async (running) => {
      const before = Number((await query<{ n: string }>("select count(*) as n from blixis_bench.writes"))[0]?.n);
      const one = CreatedRow.parse(await (await send(running)).json());
      const two = CreatedRow.parse(await (await send(running)).json());
      const bad = await fetch(`http://127.0.0.1:${running.port}/items`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "" }) });
      const after = Number((await query<{ n: string }>("select count(*) as n from blixis_bench.writes"))[0]?.n);

      expect(one.name).toBe("benchmark");
      expect(two.id).toBeGreaterThan(one.id);
      expect(after - before).toBe(2);
      expect(bad.status).toBe(400);
    });
  });

  it("database-write answers 201", async () => {
    await withScenario("database-write", async (running) => {
      expect((await send(running)).status).toBe(201);
    });
  });
});
