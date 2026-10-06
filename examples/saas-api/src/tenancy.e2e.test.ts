import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE } from "./db/index.js";
import { call, field, signUp, startApp, stringField, type Account, type TestApp } from "./test-support.js";

let test: TestApp;
let alice: Account;
let bob: Account;
let aliceProject: string;
let bobProject: string;

const base = (account: Account) => `/spaces/${account.spaceId}/projects`;

beforeAll(async () => {
  test = await startApp();
  alice = await signUp(test.app, "alice");
  bob = await signUp(test.app, "bob");
  aliceProject = stringField((await call(test.app, "POST", base(alice), { token: alice.accessToken, body: { title: "alice's project" } })).json, "id");
  bobProject = stringField((await call(test.app, "POST", base(bob), { token: bob.accessToken, body: { title: "bob's project" } })).json, "id");
  await call(test.app, "POST", `${base(bob)}/${bobProject}/tasks`, { token: bob.accessToken, body: { title: "bob's task" } });
});

afterAll(async () => {
  await test.close();
});

describe("a member working in their own space", () => {
  it("creates, lists, reads, renames and deletes projects", async () => {
    const created = await call(test.app, "POST", base(alice), { token: alice.accessToken, body: { title: "draft" } });
    expect(created.status).toBe(201);
    const id = stringField(created.json, "id");
    expect(created.json).toMatchObject({ title: "draft", spaceId: alice.spaceId });

    const list = await call(test.app, "GET", base(alice), { token: alice.accessToken });
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.json)).toContain(id);

    const renamed = await call(test.app, "PATCH", `${base(alice)}/${id}`, { token: alice.accessToken, body: { title: "final" } });
    expect(renamed.json).toMatchObject({ title: "final" });

    expect((await call(test.app, "DELETE", `${base(alice)}/${id}`, { token: alice.accessToken })).status).toBe(204);
    expect((await call(test.app, "GET", `${base(alice)}/${id}`, { token: alice.accessToken })).status).toBe(404);
  });

  it("adds tasks to a project and lists them", async () => {
    const added = await call(test.app, "POST", `${base(alice)}/${aliceProject}/tasks`, { token: alice.accessToken, body: { title: "write the docs" } });
    expect(added.status).toBe(201);
    expect(added.json).toMatchObject({ title: "write the docs", done: false, projectId: aliceProject });

    const tasks = await call(test.app, "GET", `${base(alice)}/${aliceProject}/tasks`, { token: alice.accessToken });

    expect(tasks.status).toBe(200);
    expect(JSON.stringify(tasks.json)).toContain("write the docs");
  });

  it("answers 400 problem+json with the issues for an invalid body", async () => {
    const reply = await call(test.app, "POST", base(alice), { token: alice.accessToken, body: { title: "" } });

    expect(reply.status).toBe(400);
    expect(reply.headers.get("content-type")).toBe("application/problem+json");
    expect(field(reply.json, "issues")).toEqual(expect.any(Array));
  });
});

describe("denied: someone who is not in the space", () => {
  it("is 404, never 403, for every route of another organization's space, so the space cannot even be told to exist", async () => {
    const routes: Array<[string, string, unknown?]> = [
      ["GET", base(bob)],
      ["POST", base(bob), { title: "intruder" }],
      ["GET", `${base(bob)}/${bobProject}`],
      ["PATCH", `${base(bob)}/${bobProject}`, { title: "hijacked" }],
      ["DELETE", `${base(bob)}/${bobProject}`],
      ["GET", `${base(bob)}/${bobProject}/tasks`],
      ["POST", `${base(bob)}/${bobProject}/tasks`, { title: "smuggled" }],
    ];

    for (const [method, path, body] of routes) {
      const reply = await call(test.app, method, path, { token: alice.accessToken, ...(body === undefined ? {} : { body }) });
      expect([method, path, reply.status]).toEqual([method, path, 404]);
      expect(reply.text).not.toContain("bob");
    }
  });

  it("gets the same answer for a space that exists and one that does not", async () => {
    const real = await call(test.app, "GET", base(bob), { token: alice.accessToken });
    const missing = await call(test.app, "GET", `/spaces/${crypto.randomUUID()}/projects`, { token: alice.accessToken });
    const malformed = await call(test.app, "GET", "/spaces/not-a-uuid/projects", { token: alice.accessToken });

    expect([real.status, missing.status, malformed.status]).toEqual([404, 404, 404]);
    expect(real.text).toBe(missing.text);
    expect(real.text).toBe(malformed.text);
  });

  it("is 401 without a token, before any membership is looked at", async () => {
    expect((await call(test.app, "GET", base(alice))).status).toBe(401);
  });

  it("left everything of the other organization exactly as it was", async () => {
    const project = await call(test.app, "GET", `${base(bob)}/${bobProject}`, { token: bob.accessToken });
    const tasks = await call(test.app, "GET", `${base(bob)}/${bobProject}/tasks`, { token: bob.accessToken });

    expect(project.json).toMatchObject({ title: "bob's project" });
    expect(JSON.stringify(tasks.json)).toContain("bob's task");
    expect(JSON.stringify(tasks.json)).not.toContain("smuggled");
  });
});

describe("denied: a member of this space asking for another space's data by id", () => {
  it("gets 404 for another space's project through their own space (id substitution), for every operation", async () => {
    const routes: Array<[string, string, unknown?]> = [
      ["GET", `${base(alice)}/${bobProject}`],
      ["PATCH", `${base(alice)}/${bobProject}`, { title: "hijacked" }],
      ["DELETE", `${base(alice)}/${bobProject}`],
      ["GET", `${base(alice)}/${bobProject}/tasks`],
      ["POST", `${base(alice)}/${bobProject}/tasks`, { title: "smuggled" }],
    ];

    for (const [method, path, body] of routes) {
      const reply = await call(test.app, method, path, { token: alice.accessToken, ...(body === undefined ? {} : { body }) });
      expect([method, path, reply.status]).toEqual([method, path, 404]);
    }
    const intact = await call(test.app, "GET", `${base(bob)}/${bobProject}`, { token: bob.accessToken });
    expect(intact.json).toMatchObject({ title: "bob's project" });
  });

  it("gets 404 for an id that is not a uuid, not a database error", async () => {
    const reply = await call(test.app, "GET", `${base(alice)}/1%27%20or%20%271%27=%271`, { token: alice.accessToken });

    expect(reply.status).toBe(404);
  });

  it("cannot set the tenant of a new project from the request body", async () => {
    const reply = await call(test.app, "POST", base(alice), {
      token: alice.accessToken,
      body: { title: "forged", spaceId: bob.spaceId, organizationId: crypto.randomUUID() },
    });

    expect(reply.status).toBe(201);
    expect(reply.json).toMatchObject({ spaceId: alice.spaceId });
    const inBobsSpace = await call(test.app, "GET", base(bob), { token: bob.accessToken });
    expect(JSON.stringify(inBobsSpace.json)).not.toContain("forged");
  });

  it("is refused by the database itself for a task that points at another space's project, even past the application checks", async () => {
    const db = test.app.get(DATABASE);

    await expect(
      db.execute(sql`insert into saas.tasks (id, project_id, title, organization_id, space_id) values (${crypto.randomUUID()}, ${bobProject}, 'unchecked', ${crypto.randomUUID()}, ${alice.spaceId})`),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
  });
});

describe("a user in two spaces", () => {
  it("gets what the route's space says, whichever id is asked for", async () => {
    const dana = await signUp(test.app, "dana");
    const db = test.app.get(DATABASE);
    await db.execute(sql`insert into saas.memberships (user_id, space_id, organization_id, role) select ${dana.userId}, space_id, organization_id, 'member' from saas.memberships where user_id = ${bob.userId}`);
    const danaInBob = await call(test.app, "GET", `${base(bob)}/${bobProject}`, { token: dana.accessToken });
    const danaOwn = await call(test.app, "GET", base(dana), { token: dana.accessToken });
    const mix = await call(test.app, "GET", `${base(dana)}/${bobProject}`, { token: dana.accessToken });

    expect([danaInBob.status, danaOwn.status, mix.status]).toEqual([200, 200, 404]);
  });
});
