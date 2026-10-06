import { Module } from "@blixis-io/core";
import { Controller, createHttpApplication, Get } from "@blixis-io/http";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cors } from "./cors.js";
import { PostgresRateLimitStore } from "./postgres-rate-limit-store.example.js";
import { rateLimit } from "./rate-limit.js";
import { securityHeaders } from "./security-headers.js";

/** The reference Postgres store from the docs, against a real database, through the real middleware. */

const CONNECTION = "postgres://blixis:blixis@localhost:5434/blixis";
const pool = new Pool({ connectionString: CONNECTION });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Controller("things")
class ThingsController {
  @Get()
  list() {
    return { ok: true };
  }
}

@Module({ controllers: [ThingsController] })
class AppModule {}

beforeAll(async () => {
  await pool.query("drop table if exists rate_limits");
  await pool.query("create table rate_limits (key text primary key, count integer not null, reset_at timestamptz not null)");
});

beforeEach(async () => {
  await pool.query("delete from rate_limits");
});

afterAll(async () => {
  await pool.query("drop table if exists rate_limits");
  await pool.end();
});

describe("PostgresRateLimitStore", () => {
  it("counts hits on a key within one window", async () => {
    const store = new PostgresRateLimitStore(pool);

    const counts = [(await store.hit("k", 60_000)).count, (await store.hit("k", 60_000)).count, (await store.hit("k", 60_000)).count];

    expect(counts).toEqual([1, 2, 3]);
  });

  it("reports when the window ends, in epoch milliseconds from the database's clock", async () => {
    const store = new PostgresRateLimitStore(pool);

    const hit = await store.hit("k", 30_000);

    expect(hit.resetAt).toBeGreaterThan(Date.now() + 25_000);
    expect(hit.resetAt).toBeLessThan(Date.now() + 35_000);
  });

  it("starts a new window once the old one has ended", async () => {
    const store = new PostgresRateLimitStore(pool);
    await store.hit("k", 150);
    await store.hit("k", 150);

    await sleep(250);

    expect((await store.hit("k", 150)).count).toBe(1);
  });

  it("keeps keys apart", async () => {
    const store = new PostgresRateLimitStore(pool);
    await store.hit("a", 60_000);

    expect((await store.hit("b", 60_000)).count).toBe(1);
  });

  it("gives every one of many simultaneous hits a different count, so no hit is lost", async () => {
    const store = new PostgresRateLimitStore(pool);

    const hits = await Promise.all(Array.from({ length: 40 }, () => store.hit("burst", 60_000)));

    expect(hits.map((hit) => hit.count).toSorted((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
  });
});

describe("one limit across two instances sharing the store", () => {
  it("enforces the limit across both, where in-memory stores would each allow it in full", async () => {
    const store = new PostgresRateLimitStore(pool);
    const make = () => createHttpApplication(AppModule, { middleware: [rateLimit({ store, limit: 4, windowMs: 60_000, key: () => "caller" })] });
    const [one, two] = await Promise.all([make(), make()]);
    const call = (app: typeof one) => app.handle(new Request("http://localhost/things"));

    const statuses = (await Promise.all([call(one), call(two), call(one), call(two), call(one), call(two)])).map((response) => response.status);

    expect(statuses.filter((status) => status === 200)).toHaveLength(4);
    expect(statuses.filter((status) => status === 429)).toHaveLength(2);
    await one.close();
    await two.close();
  });
});

describe("the middleware together", () => {
  it("keeps the CORS and security headers on a 429, because they sit outside the limiter", async () => {
    const store = new PostgresRateLimitStore(pool);
    const app = await createHttpApplication(AppModule, {
      middleware: [cors({ origins: ["https://app.example.com"] }), securityHeaders(), rateLimit({ store, limit: 1, windowMs: 60_000, key: () => "caller" })],
    });
    const call = () => app.handle(new Request("http://localhost/things", { headers: { origin: "https://app.example.com" } }));
    await call();

    const limited = await call();

    expect(limited.status).toBe(429);
    expect(limited.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(limited.headers.get("x-content-type-options")).toBe("nosniff");
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    await app.close();
  });

  it("answers a preflight without spending any of the rate limit", async () => {
    const store = new PostgresRateLimitStore(pool);
    const app = await createHttpApplication(AppModule, {
      middleware: [cors({ origins: ["https://app.example.com"] }), rateLimit({ store, limit: 1, windowMs: 60_000, key: () => "caller" })],
    });

    for (let index = 0; index < 5; index += 1) {
      const preflight = await app.handle(
        new Request("http://localhost/things", { method: "OPTIONS", headers: { origin: "https://app.example.com", "access-control-request-method": "GET" } }),
      );
      expect(preflight.status).toBe(204);
    }

    expect((await app.handle(new Request("http://localhost/things"))).status).toBe(200);
    await app.close();
  });
});
