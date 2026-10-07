import { Module } from "@blixis-io/core";
import { Controller, createHttpApplication, Get, RequestContext } from "@blixis-io/http";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineAuthModule } from "./module.js";
import { PostgresApiKeyStore } from "./postgres-api-key-store.example.js";
import { PG_POOL } from "./postgres-refresh-store.example.js";

/** The reference Postgres store from the docs, behind the real guard, against a real database, in a schema of its own. */

const CONNECTION = process.env["DATABASE_URL"] ?? "postgres://blixis:blixis@localhost:5434/blixis";
const schema = `api_keys_test_${crypto.randomUUID().replaceAll("-", "")}`;
const ClaimsSchema = z.object({ sub: z.string(), roles: z.array(z.string()) });

// Every connection of this pool looks in the test's own schema first, so the `api_keys` of the docs is created here
// without touching, or racing, anything else that runs against this database.
const admin = new Pool({ connectionString: CONNECTION });
const pool = new Pool({ connectionString: CONNECTION, options: `-c search_path=${schema}` });

const auth = defineAuthModule(ClaimsSchema);

@Controller("things")
class ThingsController {
  constructor(private readonly ctx: RequestContext) {}

  @Get("whoami")
  whoami() {
    return { user: auth.getCurrentUser(this.ctx), key: auth.getCurrentApiKey(this.ctx) ?? null };
  }
}

@Module({ providers: [{ provide: PG_POOL, useValue: pool }], exports: [PG_POOL] })
class PoolModule {}

let store: PostgresApiKeyStore;
let url: (path: string) => string;
let close: () => Promise<void>;

beforeAll(async () => {
  await admin.query(`create schema ${schema}`);
  await pool.query(`create table api_keys (
    id text primary key,
    secret_hash text not null,
    claims jsonb not null,
    scopes text[] not null default '{}',
    allowed_cidrs text[] not null default '{}',
    expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz not null default now(),
    last_used_at timestamptz
  )`);
  store = new PostgresApiKeyStore(pool);

  @Module({
    imports: [
      auth.AuthModule.forRoot({
        secret: "test-secret-at-least-32-bytes-long!!",
        protectAllRoutes: true,
        apiKeys: { store: PostgresApiKeyStore, imports: [PoolModule], lastUsedIntervalSeconds: 0 },
      }),
    ],
    controllers: [ThingsController],
  })
  class TestModule {}
  const app = await createHttpApplication(TestModule);
  const { port } = await app.listen(0, "127.0.0.1");
  url = (path) => `http://127.0.0.1:${port}/things/${path}`;
  close = () => app.close();
});

afterAll(async () => {
  await close();
  await admin.query(`drop schema ${schema} cascade`);
  await pool.end();
  await admin.end();
});

const call = (key: string) => fetch(url("whoami"), { headers: { "x-api-key": key } });

describe("PostgresApiKeyStore behind the auth guard", () => {
  it("a created key authenticates as its claims, with its scopes", async () => {
    const { id, key } = await store.create({ claims: { sub: "billing", roles: ["reader"] }, scopes: ["invoices:read"] });

    const response = await call(key);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: { sub: "billing", roles: ["reader"] }, key: { id, scopes: ["invoices:read"] } });
  });

  it("stores only a hash: neither the key nor its secret is anywhere in the row", async () => {
    const { id, key } = await store.create({ claims: { sub: "x", roles: [] } });
    const secret = key.split("_").slice(2).join("_");

    const { rows } = await pool.query<{ row: string }>("select api_keys::text as row from api_keys where id = $1", [id]);

    expect(rows[0]?.row).not.toContain(secret);
    expect(rows[0]?.row).not.toContain(key);
  });

  it("refuses a revoked key at once, and revoking twice keeps the first time", async () => {
    const { id, key } = await store.create({ claims: { sub: "r", roles: [] } });
    expect((await call(key)).status).toBe(200);

    expect(await store.revoke(id)).toBe(true);
    const first = await pool.query<{ revoked_at: Date }>("select revoked_at from api_keys where id = $1", [id]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await store.revoke(id);
    const second = await pool.query<{ revoked_at: Date }>("select revoked_at from api_keys where id = $1", [id]);

    expect((await call(key)).status).toBe(401);
    expect(second.rows[0]?.revoked_at).toEqual(first.rows[0]?.revoked_at);
    expect(await store.revoke("0".repeat(24))).toBe(false);
  });

  it("refuses an expired key and accepts one that has not expired yet", async () => {
    const past = await store.create({ claims: { sub: "e", roles: [] }, expiresAt: new Date(Date.now() - 1000) });
    const future = await store.create({ claims: { sub: "f", roles: [] }, expiresAt: new Date(Date.now() + 60_000) });

    expect((await call(past.key)).status).toBe(401);
    expect((await call(future.key)).status).toBe(200);
  });

  it("applies allowed_cidrs from the database to the connecting address", async () => {
    const inside = await store.create({ claims: { sub: "i", roles: [] }, allowedCidrs: ["127.0.0.0/8"] });
    const outside = await store.create({ claims: { sub: "o", roles: [] }, allowedCidrs: ["203.0.113.0/24", "2001:db8::/32"] });

    expect((await call(inside.key)).status).toBe(200);
    expect((await call(outside.key)).status).toBe(401);
  });

  it("records when a key was last used", async () => {
    const { id, key } = await store.create({ claims: { sub: "u", roles: [] } });
    expect((await pool.query<{ last_used_at: Date | null }>("select last_used_at from api_keys where id = $1", [id])).rows[0]?.last_used_at).toBeNull();

    await call(key);
    let used: Date | null = null;
    for (let waited = 0; waited < 2_000 && used === null; waited += 20) {
      await new Promise((resolve) => setTimeout(resolve, 20)); // best effort and not awaited by the request
      used = (await pool.query<{ last_used_at: Date | null }>("select last_used_at from api_keys where id = $1", [id])).rows[0]?.last_used_at ?? null;
    }

    expect(used).toBeInstanceOf(Date);
  });

  it("two keys for one client are both valid until the old one is revoked (rotation)", async () => {
    const claims = { sub: "rotating", roles: [] };
    const old = await store.create({ claims });
    const next = await store.create({ claims });

    expect((await call(old.key)).status).toBe(200);
    expect((await call(next.key)).status).toBe(200);
    await store.revoke(old.id);

    expect((await call(old.key)).status).toBe(401);
    expect((await call(next.key)).status).toBe(200);
  });

  it("refuses a key whose stored claims no longer fit the schema", async () => {
    const { id, key } = await store.create({ claims: { sub: "ok", roles: [] } });
    await pool.query(`update api_keys set claims = '{"sub": 7}'::jsonb where id = $1`, [id]);

    expect((await call(key)).status).toBe(401);
  });
});
