import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { health } from "./platform/health.js";
import { call, field, signUp, startApp, TEST_ORIGIN, type TestApp } from "./test-support.js";

let test: TestApp;

beforeAll(async () => {
  test = await startApp();
});

afterAll(async () => {
  await test.close();
});

describe("request ids", () => {
  it("puts an id on every response, a 404 and a 401 included, and keeps one a client sent", async () => {
    const ok = await call(test.app, "GET", "/livez");
    const missing = await call(test.app, "GET", "/nowhere");
    const denied = await call(test.app, "GET", "/me");
    const named = await call(test.app, "GET", "/nowhere", { headers: { "x-request-id": "client-chosen-1" } });

    expect(missing.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(denied.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(named.headers.get("x-request-id")).toBe("client-chosen-1");
    expect(ok.headers.get("x-request-id")).toBeNull(); // probes are answered before the id is assigned
  });

  it("writes one access-log line per request with the same id as the response, and no query string", async () => {
    test.logs.length = 0;

    const reply = await call(test.app, "GET", "/nowhere?token=secret");

    const entries = test.logs.filter((record) => record.message === "request");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.context).toMatchObject({ method: "GET", path: "/nowhere", status: 404, requestId: reply.headers.get("x-request-id") });
    expect(JSON.stringify(entries)).not.toContain("secret");
  });

  it("ties an unexpected error to the same id, in the log and on the response", async () => {
    test.app.mount("GET", "/boom", () => {
      throw new Error("database password is hunter2");
    });
    test.logs.length = 0;

    const reply = await call(test.app, "GET", "/boom");

    expect(reply.status).toBe(500);
    expect(reply.text).not.toContain("hunter2");
    const failure = test.logs.find((record) => record.message === "unexpected error");
    expect(failure?.context).toMatchObject({ requestId: reply.headers.get("x-request-id"), path: "/boom", phase: "request" });
  });
});

describe("browsers: CORS and security headers", () => {
  it("answers a preflight from the configured origin without reaching a route, and gives another origin nothing", async () => {
    const allowed = await call(test.app, "OPTIONS", "/spaces/x/projects", { headers: { origin: TEST_ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type" } });
    const other = await call(test.app, "OPTIONS", "/spaces/x/projects", { headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(TEST_ORIGIN);
    expect(allowed.headers.get("access-control-allow-headers")).toBe("authorization, content-type");
    expect(other.status).toBe(204);
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("keeps the CORS and security headers on a 401 and a 404, so the front end can read the real status", async () => {
    const denied = await call(test.app, "GET", "/me", { headers: { origin: TEST_ORIGIN } });
    const missing = await call(test.app, "GET", "/nowhere", { headers: { origin: TEST_ORIGIN } });

    for (const reply of [denied, missing]) {
      expect(reply.headers.get("access-control-allow-origin")).toBe(TEST_ORIGIN);
      expect(reply.headers.get("x-content-type-options")).toBe("nosniff");
      expect(reply.headers.get("content-security-policy")).toContain("default-src 'none'");
    }
  });
});

describe("health", () => {
  it("is alive and ready, naming the database check", async () => {
    const live = await call(test.app, "GET", "/livez");
    const ready = await call(test.app, "GET", "/readyz");

    expect(live.status).toBe(200);
    expect(ready.status).toBe(200);
    expect(field(ready.json, "checks", "database", "status")).toBe("ok");
  });

  it("is not ready, without leaking why, when a dependency's check fails", async () => {
    const remove = health.check("payments", () => Promise.reject(new Error("connect ECONNREFUSED 10.1.2.3:5432")));

    const ready = await call(test.app, "GET", "/readyz");
    remove();

    expect(ready.status).toBe(503);
    expect(field(ready.json, "checks", "payments", "status")).toBe("fail");
    expect(ready.text).not.toContain("ECONNREFUSED");
    expect((await call(test.app, "GET", "/readyz")).status).toBe(200);
  });
});

describe("a stranger's first minute", () => {
  it("signs up, lists their space, and creates a project, end to end over a real socket", async () => {
    const { port } = await test.app.listen(0, "127.0.0.1");
    const url = `http://127.0.0.1:${port}`;
    const account = await signUp(test.app, "walkthrough");

    const created = await fetch(`${url}/spaces/${account.spaceId}/projects`, {
      method: "POST",
      headers: { authorization: `Bearer ${account.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ title: "first project" }),
    });

    expect(created.status).toBe(201);
    expect(created.headers.get("x-request-id")).toBeTruthy();
  });
});
