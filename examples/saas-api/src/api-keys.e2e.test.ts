import { generateApiKey } from "@blixis-io/auth";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE } from "./db/index.js";
import { call, field, signUp, startApp, stringField, type Account, type TestApp } from "./test-support.js";

// Real Postgres, nothing mocked, through the whole application. API keys are machine credentials bound to one space.

let test: TestApp;
let alice: Account;
let bob: Account;
let url: (path: string) => string;
const db = () => test.app.get(DATABASE);

const keysPath = (account: Account) => `/spaces/${account.spaceId}/api-keys`;
const projectsPath = (account: Account) => `/spaces/${account.spaceId}/projects`;

async function createKey(account: Account, body: Record<string, unknown> = {}) {
  const created = await call(test.app, "POST", keysPath(account), { token: account.accessToken, body: { name: "ci", scopes: ["projects:read"], ...body } });
  expect(created.status).toBe(201);
  return { id: stringField(created.json, "id"), key: stringField(created.json, "key") };
}

const post = (body: unknown) => call(test.app, "POST", keysPath(alice), { token: alice.accessToken, body });

const withKey = (key: string) => ({ headers: { "x-api-key": key } });

beforeAll(async () => {
  test = await startApp();
  alice = await signUp(test.app, "alice");
  bob = await signUp(test.app, "bob");
  const { port } = await test.app.listen(0, "127.0.0.1");
  url = (path) => `http://127.0.0.1:${port}${path}`;
});

afterAll(async () => {
  await test.close();
});

describe("creating and listing keys", () => {
  it("shows the key once, in the creation response, in the documented format", async () => {
    const created = await call(test.app, "POST", keysPath(alice), { token: alice.accessToken, body: { name: "billing", scopes: ["projects:read", "projects:write"] } });

    expect(created.status).toBe(201);
    expect(stringField(created.json, "key")).toMatch(/^blx_[0-9a-f]{24}_[A-Za-z0-9_-]{43}$/);
    expect(field(created.json, "scopes")).toEqual(["projects:read", "projects:write"]);
  });

  it("never lists the key or its hash, and stores only the hash", async () => {
    const { id, key } = await createKey(alice, { name: "listed" });
    const secret = key.split("_").slice(2).join("_");

    const listed = await call(test.app, "GET", keysPath(alice), { token: alice.accessToken });
    const row = await db().execute<{ row: string }>(sql`select api_keys::text as row from saas.api_keys where id = ${id}`);

    expect(listed.status).toBe(200);
    expect(listed.text).toContain(id);
    expect(listed.text).not.toContain(secret);
    expect(listed.text).not.toContain("secret_hash");
    expect(listed.text).not.toContain("secretHash");
    expect(row.rows[0]?.row).not.toContain(secret);
    expect(row.rows[0]?.row).not.toContain(key);
  });

  it("refuses a bad request with a 400: unknown scope, no scopes, a typo in a network, a missing name", async () => {
    expect((await post({ name: "x", scopes: ["admin:everything"] })).status).toBe(400);
    expect((await post({ name: "x", scopes: [] })).status).toBe(400);
    expect((await post({ name: "x", scopes: ["projects:read"], allowedCidrs: ["192.168.1.5/24"] })).status).toBe(400);
    expect((await post({ name: "x", scopes: ["projects:read"], allowedCidrs: ["not-a-network"] })).status).toBe(400);
    expect((await post({ scopes: ["projects:read"] })).status).toBe(400);
    expect((await post({ name: "x", scopes: ["projects:read"], expiresInDays: 0 })).status).toBe(400);
  });

  it("answers 404, as for any space you are not in, when asked to manage another space's keys", async () => {
    const attempt = await call(test.app, "POST", keysPath(bob), { token: alice.accessToken, body: { name: "x", scopes: ["projects:read"] } });
    const list = await call(test.app, "GET", keysPath(bob), { token: alice.accessToken });

    expect(attempt.status).toBe(404);
    expect(list.status).toBe(404);
  });

  it("needs a token: no credentials is a 401", async () => {
    expect((await call(test.app, "POST", keysPath(alice), { body: { name: "x", scopes: ["projects:read"] } })).status).toBe(401);
  });
});

describe("using a key", () => {
  it("reads with projects:read, and is refused a write with a 403 (not a 401)", async () => {
    const { key } = await createKey(alice, { scopes: ["projects:read"] });

    const read = await call(test.app, "GET", projectsPath(alice), withKey(key));
    const write = await call(test.app, "POST", projectsPath(alice), { ...withKey(key), body: { title: "nope" } });

    expect(read.status).toBe(200);
    expect(write.status).toBe(403);
  });

  it("writes with projects:write, and the project lands in the key's space", async () => {
    const { key } = await createKey(alice, { scopes: ["projects:write"] });

    const created = await call(test.app, "POST", projectsPath(alice), { ...withKey(key), body: { title: "made by a key" } });

    expect(created.status).toBe(201);
    expect(field(created.json, "spaceId")).toBe(alice.spaceId);
    // `projects:write` alone does not read: the listing needs `projects:read`.
    expect((await call(test.app, "GET", projectsPath(alice), withKey(key))).status).toBe(403);
  });

  it("acts only in its own space: another space is a 404, never data", async () => {
    const { key } = await createKey(alice, { scopes: ["projects:read", "projects:write"] });
    await call(test.app, "POST", projectsPath(bob), { token: bob.accessToken, body: { title: "bob's secret project" } });

    const read = await call(test.app, "GET", projectsPath(bob), withKey(key));
    const write = await call(test.app, "POST", projectsPath(bob), { ...withKey(key), body: { title: "intruder" } });

    expect(read.status).toBe(404);
    expect(write.status).toBe(404);
    expect(read.text).not.toContain("bob's secret project");
  });

  it("cannot reach a route that does not say what it needs: /me is closed to keys", async () => {
    const { key } = await createKey(alice, { scopes: ["projects:read", "projects:write"] });

    expect((await call(test.app, "GET", "/me", withKey(key))).status).toBe(403);
  });

  it("cannot mint, list or revoke keys, even with every scope", async () => {
    const { id, key } = await createKey(alice, { scopes: ["projects:read", "projects:write"] });

    expect((await call(test.app, "POST", keysPath(alice), { ...withKey(key), body: { name: "child", scopes: ["projects:read"] } })).status).toBe(403);
    expect((await call(test.app, "GET", keysPath(alice), withKey(key))).status).toBe(403);
    expect((await call(test.app, "DELETE", `${keysPath(alice)}/${id}`, withKey(key))).status).toBe(403);
    expect((await call(test.app, "GET", keysPath(alice), withKey(key))).status).not.toBe(200);
  });

  it("is not rescued by a valid token: a bad key is a 401, whatever else is sent", async () => {
    const response = await call(test.app, "GET", projectsPath(alice), { token: alice.accessToken, headers: { "x-api-key": generateApiKey().key } });

    expect(response.status).toBe(401);
  });

  it("is refused with the same answer for a key that never existed and one that is wrong", async () => {
    const { key } = await createKey(alice);
    const wrong = `${key.slice(0, -1)}${key.endsWith("A") ? "B" : "A"}`;

    const unknown = await call(test.app, "GET", projectsPath(alice), withKey(generateApiKey().key));
    const mistyped = await call(test.app, "GET", projectsPath(alice), withKey(wrong));

    expect(unknown.status).toBe(401);
    expect(mistyped.text).toBe(unknown.text);
  });

  it("is not written to the logs: not the key, not its secret", async () => {
    const { key } = await createKey(alice);
    await call(test.app, "GET", projectsPath(alice), withKey(key));
    const secret = key.split("_").slice(2).join("_");

    const logged = JSON.stringify(test.logs);

    expect(logged).not.toContain(secret);
    expect(logged).not.toContain(key);
  });

  it("records when it was last used", async () => {
    const { id, key } = await createKey(alice);
    await call(test.app, "GET", projectsPath(alice), withKey(key));

    let used: unknown = null;
    for (let waited = 0; waited < 2_000 && used === null; waited += 20) {
      await new Promise((resolve) => setTimeout(resolve, 20)); // best effort: the request does not wait for it
      used = (await db().execute<{ last_used_at: Date | null }>(sql`select last_used_at from saas.api_keys where id = ${id}`)).rows[0]?.last_used_at ?? null;
    }

    expect(typeof used).toBe("string"); // a timestamp, as raw SQL returns it
  });
});

describe("revoking and expiring", () => {
  it("refuses a revoked key at once; revoking again is harmless and keeps the first time", async () => {
    const { id, key } = await createKey(alice);
    expect((await call(test.app, "GET", projectsPath(alice), withKey(key))).status).toBe(200);

    expect((await call(test.app, "DELETE", `${keysPath(alice)}/${id}`, { token: alice.accessToken })).status).toBe(204);
    const first = (await db().execute<{ revoked_at: Date }>(sql`select revoked_at from saas.api_keys where id = ${id}`)).rows[0]?.revoked_at;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await call(test.app, "DELETE", `${keysPath(alice)}/${id}`, { token: alice.accessToken })).status).toBe(204);
    const second = (await db().execute<{ revoked_at: Date }>(sql`select revoked_at from saas.api_keys where id = ${id}`)).rows[0]?.revoked_at;

    expect((await call(test.app, "GET", projectsPath(alice), withKey(key))).status).toBe(401);
    expect(second).toEqual(first);
  });

  it("will not revoke another space's key: 404, and the key still works", async () => {
    const { id, key } = await createKey(bob);

    const attempt = await call(test.app, "DELETE", `${keysPath(alice)}/${id}`, { token: alice.accessToken });

    expect(attempt.status).toBe(404);
    expect((await call(test.app, "GET", projectsPath(bob), withKey(key))).status).toBe(200);
  });

  it("refuses an expired key", async () => {
    const { id, key } = await createKey(alice, { expiresInDays: 30 });
    expect((await call(test.app, "GET", projectsPath(alice), withKey(key))).status).toBe(200);

    await db().execute(sql`update saas.api_keys set expires_at = now() - interval '1 second' where id = ${id}`);

    expect((await call(test.app, "GET", projectsPath(alice), withKey(key))).status).toBe(401);
  });

  it("two keys for one job are both valid until the old one is revoked (rotation)", async () => {
    const old = await createKey(alice, { name: "job" });
    const next = await createKey(alice, { name: "job" });

    expect((await call(test.app, "GET", projectsPath(alice), withKey(old.key))).status).toBe(200);
    expect((await call(test.app, "GET", projectsPath(alice), withKey(next.key))).status).toBe(200);
    await call(test.app, "DELETE", `${keysPath(alice)}/${old.id}`, { token: alice.accessToken });

    expect((await call(test.app, "GET", projectsPath(alice), withKey(old.key))).status).toBe(401);
    expect((await call(test.app, "GET", projectsPath(alice), withKey(next.key))).status).toBe(200);
  });
});

const get = (account: Account, key: string) => fetch(url(projectsPath(account)), { headers: { "x-api-key": key } });

describe("allowedCidrs, through a real socket", () => {
  it("accepts the connecting address inside the networks, and refuses it outside", async () => {
    const inside = await createKey(alice, { allowedCidrs: ["127.0.0.0/8"] });
    const outside = await createKey(alice, { allowedCidrs: ["203.0.113.0/24", "2001:db8::/32"] });

    expect((await get(alice, inside.key)).status).toBe(200);
    expect((await get(alice, outside.key)).status).toBe(401);
  });

  it("does not believe X-Forwarded-For when no proxy is trusted (the default here)", async () => {
    const { key } = await createKey(alice, { allowedCidrs: ["203.0.113.0/24"] });

    const response = await fetch(url(projectsPath(alice)), { headers: { "x-api-key": key, "x-forwarded-for": "203.0.113.9" } });

    expect(response.status).toBe(401);
  });

  it("refuses when the address cannot be known (an in-process call has no socket), instead of letting it through", async () => {
    const { key } = await createKey(alice, { allowedCidrs: ["0.0.0.0/0"] });

    expect((await call(test.app, "GET", projectsPath(alice), withKey(key))).status).toBe(401);
  });
});

describe("OpenAPI", () => {
  it("declares the API key scheme next to the bearer one, as alternatives", async () => {
    const document = await call(test.app, "GET", "/openapi.json");

    expect(field(document.json, "components", "securitySchemes", "apiKeyAuth")).toEqual({ type: "apiKey", in: "header", name: "x-api-key" });
    expect(field(document.json, "security")).toEqual([{ bearerAuth: [] }, { apiKeyAuth: [] }]);
  });
});
