import { describe, expect, it } from "vitest";
import { call, field, signUp, startApp, stringField } from "./test-support.js";

// Its own file: it starts an application whose relay loop is on, and closes it.

describe("the relay loop", () => {
  it("delivers by itself, and stops cleanly when the application closes", async () => {
    const test = await startApp({ OUTBOX_POLL_MS: "25" });
    // The test helper migrates after the application boots, so the loop's first pass can run before the table exists: it
    // reports that, backs off and carries on, which is the behaviour wanted. In production the migration step runs first.
    // Failures are only interesting from here on.
    test.logs.length = 0;
    const alice = await signUp(test.app, "loop");
    const created = await call(test.app, "POST", `/spaces/${alice.spaceId}/projects`, { token: alice.accessToken, body: { title: "By itself" } });
    expect(created.status).toBe(201);
    expect(stringField(created.json, "title")).toBe("By itself");

    let messages: unknown[] = [];
    for (let waited = 0; waited < 5_000 && !messages.includes('Project "By itself" was created'); waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const feed = await call(test.app, "GET", `/spaces/${alice.spaceId}/activity`, { token: alice.accessToken });
      messages = Array.isArray(feed.json) ? feed.json.map((item) => field(item, "message")) : [];
    }
    expect(messages).toContain('Project "By itself" was created');

    await expect(test.close()).resolves.toBeUndefined();
    expect(test.logs.filter((log) => log.message === "outbox delivery failed")).toEqual([]);
  });
});
