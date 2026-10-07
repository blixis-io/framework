import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, signUp, startApp, stringField, type Account, type TestApp } from "./test-support.js";

// Its own file: it needs a small per-key limit, and each application is configured once.

let test: TestApp;
let alice: Account;

beforeAll(async () => {
  test = await startApp({ API_KEY_RATE_LIMIT_PER_MINUTE: "3" });
  alice = await signUp(test.app, "limit");
});

afterAll(async () => {
  await test.close();
});

async function createKey(): Promise<string> {
  const created = await call(test.app, "POST", `/spaces/${alice.spaceId}/api-keys`, { token: alice.accessToken, body: { name: "limited", scopes: ["projects:read"] } });
  return stringField(created.json, "key");
}

const read = (key: string) => call(test.app, "GET", `/spaces/${alice.spaceId}/projects`, { headers: { "x-api-key": key } });

describe("the limit per API key", () => {
  it("lets a key make its allowance, then answers 429 with Retry-After", async () => {
    const key = await createKey();

    const answers = [];
    for (let i = 0; i < 5; i += 1) {
      answers.push(await read(key));
    }

    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200, 429, 429]);
    expect(Number(answers[3]?.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("counts each key on its own, even from the same address", async () => {
    const busy = await createKey();
    const quiet = await createKey();
    for (let i = 0; i < 5; i += 1) {
      await read(busy);
    }

    expect((await read(busy)).status).toBe(429);
    expect((await read(quiet)).status).toBe(200);
  });

  it("does not count a key id that was sent without its secret: someone else cannot use up your allowance", async () => {
    const key = await createKey();
    const [prefix, id] = key.split("_");
    const withoutSecret = `${prefix}_${id}_${"A".repeat(43)}`;

    for (let i = 0; i < 10; i += 1) {
      expect((await read(withoutSecret)).status).toBe(401);
    }

    expect((await read(key)).status).toBe(200);
  });

  it("does not apply to a person: a token is limited by address only", async () => {
    for (let i = 0; i < 6; i += 1) {
      expect((await call(test.app, "GET", `/spaces/${alice.spaceId}/projects`, { token: alice.accessToken })).status).toBe(200);
    }
  });
});
