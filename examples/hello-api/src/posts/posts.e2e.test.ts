import { Test, type TestApplication } from "@blixis/testing";
import { consoleTransport, LoggerModule } from "@blixis/logging";
import { describe, expect, it } from "vitest";
import { DATABASE } from "../db/index.js";
import { posts } from "../db/schema.js";
import { PostsModule } from "./posts.module.js";
import type { Post } from "./post.schema.js";

async function createTestApp(): Promise<TestApplication> {
  const app = await Test.createModule({
    imports: [LoggerModule.forRoot({ transports: [consoleTransport()] }), PostsModule],
  }).compile();
  // Real Postgres table, shared across tests — start each test from empty.
  await app.get(DATABASE).delete(posts);
  return app;
}

describe("Posts API (e2e)", () => {
  it("creates a post and lists it back", async () => {
    const app = await createTestApp();

    const createRes = await app.request("/posts", { method: "POST", json: { title: "hi" } });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Post;
    expect(created).toMatchObject({ title: "hi", body: "" });

    const listRes = await app.request("/posts");
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual([created]);

    await app.close();
  });

  it("returns 400 problem+json with Zod issues when the body fails validation", async () => {
    const app = await createTestApp();

    const res = await app.request("/posts", { method: "POST", json: {} });

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    const problem = (await res.json()) as { issues: unknown[] };
    expect(problem.issues.length).toBeGreaterThan(0);

    await app.close();
  });

  it("returns 404 problem+json for an unknown post", async () => {
    const app = await createTestApp();

    const res = await app.request("/posts/unknown");

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");

    await app.close();
  });

  it("returns 405 with an Allow header for DELETE on the collection route", async () => {
    const app = await createTestApp();

    const res = await app.request("/posts", { method: "DELETE" });

    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toContain("GET");
    expect(res.headers.get("allow")).toContain("POST");

    await app.close();
  });

  it("denies DELETE without the api key and allows it with the key", async () => {
    const app = await createTestApp();

    const createRes = await app.request("/posts", { method: "POST", json: { title: "to delete" } });
    const { id } = (await createRes.json()) as Post;

    const denied = await app.request(`/posts/${id}`, { method: "DELETE" });
    expect(denied.status).toBe(403);

    const allowed = await app.request(`/posts/${id}`, {
      method: "DELETE",
      headers: { "x-api-key": "dev-secret" },
    });
    expect(allowed.status).toBe(204);

    await app.close();
  });

  it("updates a post via PATCH with a partial body", async () => {
    const app = await createTestApp();

    const createRes = await app.request("/posts", { method: "POST", json: { title: "original" } });
    const { id } = (await createRes.json()) as Post;

    const patchRes = await app.request(`/posts/${id}`, { method: "PATCH", json: { title: "updated" } });

    expect(patchRes.status).toBe(200);
    expect(((await patchRes.json()) as Post).title).toBe("updated");

    await app.close();
  });
});
