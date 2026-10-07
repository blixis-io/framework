import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DATABASE } from "./db/index.js";
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

  it("purges delivered rows past the retention by itself, and leaves younger ones and undelivered ones", async () => {
    const test = await startApp({ OUTBOX_POLL_MS: "25", OUTBOX_RETENTION_DAYS: "30", OUTBOX_PURGE_INTERVAL_MS: "50" });
    const database = test.app.get(DATABASE);
    // The application's relay handles `project.created`, so that is the topic whose old rows it purges. Rows are found by id:
    // other tests create `project.created` rows of their own at the same time.
    const [old, young, waiting] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await database.execute(sql`
      insert into saas.outbox (id, topic, payload, processed_at) values
        (${old}, 'project.created', '{}', now() - interval '45 days'),
        (${young}, 'project.created', '{}', now() - interval '10 days'),
        (${waiting}, 'other.service', '{}', now() - interval '45 days')`);
    const present = async (): Promise<string[]> =>
      (await database.execute<{ id: string }>(sql`select id from saas.outbox where id in (${old}, ${young}, ${waiting}) order by id`)).rows.map((row) => row.id);

    let ids = await present();
    for (let waited = 0; waited < 5_000 && ids.includes(old); waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      ids = await present();
    }
    await new Promise((resolve) => setTimeout(resolve, 200)); // time for more purges to prove they stop there
    ids = await present();

    expect(ids).not.toContain(old); // delivered and past the retention
    expect(ids).toContain(young); // delivered, within the retention
    expect(ids).toContain(waiting); // another topic: not this relay's to purge, however old
    await test.close();
  });
});
