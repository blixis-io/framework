import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE } from "./db/index.js";
import { call, field, PASSWORD, signUp, startApp, stringField, uniqueEmail, type TestApp } from "./test-support.js";

let test: TestApp;

beforeAll(async () => {
  test = await startApp();
});

afterAll(async () => {
  await test.close();
});

describe("sign-up", () => {
  it("creates the account, its organization, a first space and the membership, and answers with tokens", async () => {
    const email = uniqueEmail("alice");

    const created = await call(test.app, "POST", "/auth/sign-up", { body: { email, password: PASSWORD, organizationName: "Acme" } });

    expect(created.status).toBe(201);
    expect(field(created.json, "accessToken")).toEqual(expect.any(String));
    expect(field(created.json, "refreshToken")).toEqual(expect.any(String));
    const me = await call(test.app, "GET", "/me", { token: stringField(created.json, "accessToken") });
    expect(me.json).toMatchObject({ email, spaces: [{ name: "Main", organization: "Acme", role: "owner" }] });
  });

  it("is one transaction: a taken email leaves no organization or space behind, and answers 409", async () => {
    const first = await signUp(test.app, "dup");
    const db = test.app.get(DATABASE);
    const before = await db.execute<{ n: string }>(sql`select (select count(*) from saas.organizations) as n`);

    const again = await call(test.app, "POST", "/auth/sign-up", { body: { email: first.email, password: PASSWORD, organizationName: "Ghost" } });

    expect(again.status).toBe(409);
    expect(again.headers.get("content-type")).toBe("application/problem+json");
    const after = await db.execute<{ n: string }>(sql`select (select count(*) from saas.organizations) as n`);
    expect(Number(after.rows[0]?.n)).toBeGreaterThanOrEqual(Number(before.rows[0]?.n));
    const ghosts = await db.execute<{ n: string }>(sql`select count(*) as n from saas.organizations where name = 'Ghost'`);
    expect(Number(ghosts.rows[0]?.n)).toBe(0);
  });

  it("rejects a short password and a bad email with 400 and the validation issues", async () => {
    const weak = await call(test.app, "POST", "/auth/sign-up", { body: { email: uniqueEmail(), password: "short", organizationName: "x" } });
    const bad = await call(test.app, "POST", "/auth/sign-up", { body: { email: "not-an-email", password: PASSWORD, organizationName: "x" } });

    expect([weak.status, bad.status]).toEqual([400, 400]);
    expect(weak.headers.get("content-type")).toBe("application/problem+json");
    expect(field(weak.json, "issues")).toEqual(expect.any(Array));
  });

  it("treats the email case-insensitively", async () => {
    const account = await signUp(test.app, "case");

    const signedIn = await call(test.app, "POST", "/auth/sign-in", { body: { email: account.email.toUpperCase(), password: PASSWORD } });

    expect(signedIn.status).toBe(200);
  });
});

describe("sign-in", () => {
  it("gives tokens for the right password", async () => {
    const account = await signUp(test.app);

    const signedIn = await call(test.app, "POST", "/auth/sign-in", { body: { email: account.email, password: PASSWORD } });

    expect(signedIn.status).toBe(200);
    expect(field(signedIn.json, "accessToken")).toEqual(expect.any(String));
  });

  it("answers the same 401 for a wrong password and an unknown email, revealing nothing", async () => {
    const account = await signUp(test.app);

    const wrong = await call(test.app, "POST", "/auth/sign-in", { body: { email: account.email, password: "not the password at all" } });
    const unknown = await call(test.app, "POST", "/auth/sign-in", { body: { email: uniqueEmail("nobody"), password: PASSWORD } });

    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.text).toBe(unknown.text);
  });
});

describe("tokens", () => {
  it("answers 401 to a protected route without a token, with a malformed one, and with a refresh token used as an access token", async () => {
    const account = await signUp(test.app);

    const none = await call(test.app, "GET", "/me");
    const garbage = await call(test.app, "GET", "/me", { token: "not.a.jwt" });
    const wrongKind = await call(test.app, "GET", "/me", { token: account.refreshToken });

    expect([none.status, garbage.status, wrongKind.status]).toEqual([401, 401, 401]);
  });

  it("rotates a refresh token for a new pair, and the old one stops working", async () => {
    const account = await signUp(test.app);

    const refreshed = await call(test.app, "POST", "/auth/refresh", { body: { refreshToken: account.refreshToken } });

    expect(refreshed.status).toBe(200);
    expect(stringField(refreshed.json, "refreshToken")).not.toBe(account.refreshToken);
    const replay = await call(test.app, "POST", "/auth/refresh", { body: { refreshToken: account.refreshToken } });
    expect(replay.status).toBe(401);
  });

  it("ends only the login a replayed token belongs to: the same user's other device keeps working", async () => {
    const phone = await signUp(test.app, "devices");
    const laptop = await call(test.app, "POST", "/auth/sign-in", { body: { email: phone.email, password: PASSWORD } });
    const phoneNext = await call(test.app, "POST", "/auth/refresh", { body: { refreshToken: phone.refreshToken } });

    const replay = await call(test.app, "POST", "/auth/refresh", { body: { refreshToken: phone.refreshToken } }); // an old token shown again

    expect(replay.status).toBe(401);
    const phoneAgain = await call(test.app, "POST", "/auth/refresh", { body: { refreshToken: stringField(phoneNext.json, "refreshToken") } });
    expect(phoneAgain.status).toBe(401); // that login is over
    const laptopAgain = await call(test.app, "POST", "/auth/refresh", { body: { refreshToken: stringField(laptop.json, "refreshToken") } });
    expect(laptopAgain.status).toBe(200); // the other one is not
  });

  it("signs out one login idempotently", async () => {
    const account = await signUp(test.app);

    const first = await call(test.app, "POST", "/auth/sign-out", { body: { refreshToken: account.refreshToken } });
    const second = await call(test.app, "POST", "/auth/sign-out", { body: { refreshToken: account.refreshToken } });
    const after = await call(test.app, "POST", "/auth/refresh", { body: { refreshToken: account.refreshToken } });

    expect([first.status, second.status, after.status]).toEqual([204, 204, 401]);
  });
});
