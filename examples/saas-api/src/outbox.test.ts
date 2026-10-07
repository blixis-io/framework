import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE } from "./db/index.js";
import { activity } from "./db/schema.js";
import { enqueue } from "./outbox/outbox.js";
import { OutboxRelay } from "./outbox/outbox-relay.js";
import type { OutboxHandler } from "./outbox/handlers.js";
import { call, field, signUp, startApp, stringField, type Account, type TestApp } from "./test-support.js";

// Real Postgres, nothing mocked. Other test files write outbox rows into the same table, so every assertion here is about
// rows this file made (its own space, or a topic nobody else uses), never about "the" count of rows or "the" batch.

let test: TestApp;
let alice: Account;
const db = () => test.app.get(DATABASE);
const relay = () => test.app.get(OutboxRelay);

interface OutboxRow extends Record<string, unknown> {
  id: string;
  attempts: number;
  last_error: string | null;
  processed_at: string | null;
  failed_at: string | null;
  due: boolean;
}

async function row(id: string): Promise<OutboxRow> {
  const result = await db().execute<OutboxRow>(sql`select id, attempts, last_error, processed_at, failed_at, available_at <= now() as due from saas.outbox where id = ${id}`);
  const found = result.rows[0];
  if (!found) {
    throw new Error(`no outbox row ${id}`);
  }
  return found;
}

/**
 * Waits until `check` stops throwing. The loop relay in `outbox.e2e.test.ts` shares this table and may be holding one of
 * these rows locked, mid-delivery, at the moment of a read; the delivery is real, it just has not committed yet.
 */
async function eventually(check: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

/** A promise and the function that settles it, for coordinating two things in a test. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  const box: { resolve?: () => void } = {};
  const promise = new Promise<void>((resolve) => {
    box.resolve = resolve;
  });
  return { promise, resolve: () => box.resolve?.() };
}

const topic = () => `test.${crypto.randomUUID()}`;

/** A relay that only knows the given topics, with its own limits, over the application's database. */
const relayFor = (handlers: Record<string, OutboxHandler>, options: { maxAttempts?: number; batchSize?: number; retentionDays?: number } = {}) =>
  new OutboxRelay(db(), {
    pollMs: 0,
    maxAttempts: options.maxAttempts ?? 5,
    batchSize: options.batchSize ?? 20,
    handlers,
    ...(options.retentionDays === undefined ? {} : { retentionDays: options.retentionDays }),
  });

beforeAll(async () => {
  test = await startApp();
  alice = await signUp(test.app, "alice");
});

afterAll(async () => {
  await test.close();
});

describe("writing the event with the change", () => {
  it("a created project comes with exactly one outbox row, not yet delivered", async () => {
    const created = await call(test.app, "POST", `/spaces/${alice.spaceId}/projects`, { token: alice.accessToken, body: { title: "Atomic" } });
    expect(created.status).toBe(201);
    const projectId = stringField(created.json, "id");

    const rows = await db().execute<OutboxRow & { payload: unknown }>(
      sql`select id, topic, payload, processed_at from saas.outbox where payload->>'projectId' = ${projectId}`,
    );

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.["topic"]).toBe("project.created");
    expect(rows.rows[0]?.["processed_at"]).toBeNull();
    expect(rows.rows[0]?.["payload"]).toMatchObject({ projectId, title: "Atomic", spaceId: alice.spaceId });
  });

  it("the service creates the project and the event as one: when the event cannot be written, there is no project", async () => {
    const poison = `poison-${crypto.randomUUID()}`;
    // A trigger that refuses the outbox row of exactly this title, so nothing else running against the database is touched.
    await db().execute(sql.raw(`
      create or replace function saas.refuse_poison() returns trigger language plpgsql as $$
      begin
        if new.payload->>'title' like 'poison-%' then raise exception 'refused by the test'; end if;
        return new;
      end $$`));
    await db().execute(sql.raw("drop trigger if exists refuse_poison on saas.outbox"));
    await db().execute(sql.raw("create trigger refuse_poison before insert on saas.outbox for each row execute function saas.refuse_poison()"));
    try {
      const failed = await call(test.app, "POST", `/spaces/${alice.spaceId}/projects`, { token: alice.accessToken, body: { title: poison } });

      expect(failed.status).toBe(500);
      expect((await db().execute(sql`select 1 from saas.projects where title = ${poison}`)).rows).toHaveLength(0);
    } finally {
      await db().execute(sql.raw("drop trigger if exists refuse_poison on saas.outbox"));
    }
  });

  it("an event that cannot be written takes the change with it, and a failure after both rolls both back", async () => {
    const id = crypto.randomUUID();
    const space = alice.spaceId;
    const insertProject = (tx: Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0]) =>
      tx.execute(sql`insert into saas.projects (id, title, organization_id, space_id) select ${id}, 'orphan', organization_id, id from saas.spaces where id = ${space}`);

    // 1. the event insert fails (a payload that is not there violates `not null`): the project is not created
    await expect(
      db().transaction(async (tx) => {
        await insertProject(tx);
        await enqueue(tx, "project.created", undefined);
      }),
    ).rejects.toThrow(/null value|not-null|payload/i);
    // 2. both succeed and then something else throws: neither survives
    await expect(
      db().transaction(async (tx) => {
        await insertProject(tx);
        await enqueue(tx, "project.created", { projectId: id });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const projects = await db().execute(sql`select 1 from saas.projects where id = ${id}`);
    const events = await db().execute(sql`select 1 from saas.outbox where payload->>'projectId' = ${id}`);
    expect(projects.rows).toHaveLength(0);
    expect(events.rows).toHaveLength(0);
  });
});

describe("delivery", () => {
  it("delivers a created project to its consumer, and the result is visible through the API", async () => {
    const created = await call(test.app, "POST", `/spaces/${alice.spaceId}/projects`, { token: alice.accessToken, body: { title: "Delivered" } });
    const projectId = stringField(created.json, "id");

    await relay().runOnce();

    await eventually(async () => {
      const events = await db().execute<OutboxRow>(sql`select id, processed_at from saas.outbox where payload->>'projectId' = ${projectId}`);
      expect(events.rows[0]?.processed_at).not.toBeNull();
      const feed = await call(test.app, "GET", `/spaces/${alice.spaceId}/activity`, { token: alice.accessToken });
      expect(feed.status).toBe(200);
      const messages = Array.isArray(feed.json) ? feed.json.map((item) => field(item, "message")) : [];
      expect(messages).toContain('Project "Delivered" was created');
    });
  });

  it("delivering the same event again leaves one result: the consumer is idempotent", async () => {
    const created = await call(test.app, "POST", `/spaces/${alice.spaceId}/projects`, { token: alice.accessToken, body: { title: "Twice" } });
    const projectId = stringField(created.json, "id");
    await relay().runOnce();
    // As if the process died after the consumer wrote but before the delivery was recorded: the row is due again.
    await db().execute(sql`update saas.outbox set processed_at = null where payload->>'projectId' = ${projectId}`);

    await relay().runOnce();

    await eventually(async () => {
      const written = await db().execute(sql`select 1 from saas.activity where message = ${'Project "Twice" was created'} and space_id = ${alice.spaceId}`);
      expect(written.rows).toHaveLength(1);
      // And the second delivery *succeeded*: a consumer that threw on the duplicate would also leave one row.
      const again = await db().execute<OutboxRow>(sql`select processed_at, attempts from saas.outbox where payload->>'projectId' = ${projectId}`);
      expect(again.rows[0]?.processed_at).not.toBeNull();
      expect(again.rows[0]?.attempts).toBe(0);
    });
  });

  it("leaves a row for a topic it has no consumer for alone: it belongs to someone else", async () => {
    const orphan = await enqueue(db(), topic(), { n: 1 });

    await relay().runOnce();

    const after = await row(orphan);
    expect(after.attempts).toBe(0);
    expect(after.processed_at).toBeNull();
    expect(after.failed_at).toBeNull();
  });
});

describe("failure", () => {
  it("counts the attempt, backs off, undoes the consumer's own writes, then delivers when it works", async () => {
    const t = topic();
    let calls = 0;
    const flaky: OutboxHandler = async (tx, event) => {
      calls += 1;
      await tx.insert(activity).values({ id: crypto.randomUUID(), eventId: event.id, organizationId: crypto.randomUUID(), spaceId: alice.spaceId, message: `flaky ${t}` });
      if (calls === 1) {
        throw new Error("the first delivery fails");
      }
    };
    const id = await enqueue(db(), t, {});
    const mine = relayFor({ [t]: flaky });

    expect(await mine.runOnce()).toBe(1);
    const failed = await row(id);
    expect(failed.attempts).toBe(1);
    expect(failed.last_error).toBe("the first delivery fails");
    expect(failed.processed_at).toBeNull();
    expect(failed.due).toBe(false); // backed off into the future
    expect((await db().execute(sql`select 1 from saas.activity where message = ${`flaky ${t}`}`)).rows).toHaveLength(0); // its write was undone

    expect(await mine.runOnce()).toBe(0); // not due yet, so not claimed
    await db().execute(sql`update saas.outbox set available_at = now() where id = ${id}`);
    expect(await mine.runOnce()).toBe(1);

    const done = await row(id);
    expect(done.processed_at).not.toBeNull();
    expect(done.last_error).toBeNull();
    expect((await db().execute(sql`select 1 from saas.activity where message = ${`flaky ${t}`}`)).rows).toHaveLength(1);
  });

  it("one failing event does not stop the rest of its batch", async () => {
    const t = topic();
    const seen: string[] = [];
    const bad = await enqueue(db(), t, { fail: true });
    const good = await enqueue(db(), t, { fail: false });
    const mine = relayFor({
      [t]: async (_tx, event) => {
        if (field(event.payload, "fail") === true) {
          throw new Error("bad event");
        }
        seen.push(event.id);
      },
    });

    await mine.runOnce();

    expect(seen).toEqual([good]);
    expect((await row(good)).processed_at).not.toBeNull();
    expect((await row(bad)).attempts).toBe(1);
  });

  it("parks an event after maxAttempts and never retries it", async () => {
    const t = topic();
    const id = await enqueue(db(), t, {});
    const reported: number[] = [];
    const mine = new OutboxRelay(db(), {
      pollMs: 0,
      maxAttempts: 3,
      handlers: {
        [t]: () => {
          throw new Error("always");
        },
      },
      onError: (_error, event) => {
        if (event) {
          reported.push(event.attempts);
        }
      },
    });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await db().execute(sql`update saas.outbox set available_at = now() where id = ${id}`);
      expect(await mine.runOnce()).toBe(1);
    }
    await db().execute(sql`update saas.outbox set available_at = now() where id = ${id}`);

    expect(await mine.runOnce()).toBe(0);
    const parked = await row(id);
    expect(parked.attempts).toBe(3);
    expect(parked.failed_at).not.toBeNull();
    expect(reported).toEqual([1, 2, 3]);
  });
});

describe("many relays", () => {
  it("never deliver one event twice at the same time, and together deliver them all", async () => {
    const t = topic();
    const ids = await Promise.all(Array.from({ length: 40 }, (_, n) => enqueue(db(), t, { n })));
    const deliveries = new Map<string, number>();
    const handler: OutboxHandler = async (_tx, event) => {
      deliveries.set(event.id, (deliveries.get(event.id) ?? 0) + 1);
      await new Promise((resolve) => setTimeout(resolve, 5)); // long enough for the others to look at the same rows
    };
    const relays = Array.from({ length: 4 }, () => relayFor({ [t]: handler }, { batchSize: 5 }));

    let handled = 0;
    do {
      handled = (await Promise.all(relays.map((each) => each.runOnce()))).reduce((sum, n) => sum + n, 0);
    } while (handled > 0);

    expect(deliveries.size).toBe(40);
    expect([...deliveries.values()].every((count) => count === 1)).toBe(true);
    const undelivered = await db().execute(sql`select 1 from saas.outbox where topic = ${t} and processed_at is null`);
    expect(undelivered.rows).toHaveLength(0);
    expect(ids).toHaveLength(40);
  });
});

const noop: OutboxHandler = async () => {};

/** Makes `count` rows of `topic`, delivered `deliveredDaysAgo` (or not delivered), parked or not. */
async function age(t: string, options: { count?: number; deliveredDaysAgo?: number; parked?: boolean }): Promise<void> {
  const delivered = options.deliveredDaysAgo === undefined ? sql`null` : sql`now() - interval '1 day' * ${options.deliveredDaysAgo}`;
  const parked = options.parked ? sql`now() - interval '20 days'` : sql`null`;
  await db().execute(sql`
    insert into saas.outbox (id, topic, payload, created_at, processed_at, failed_at)
    select gen_random_uuid(), ${t}, '{}'::jsonb, now() - interval '30 days', ${delivered}, ${parked}
    from generate_series(1, ${options.count ?? 1})`);
}

const remaining = async (t: string): Promise<number> => Number((await db().execute<{ n: string }>(sql`select count(*) as n from saas.outbox where topic = ${t}`)).rows[0]?.n);

// A relay that handles only `t`, so its purge can only ever concern `t`: other tests, and other processes, age rows of their own.
const purger = (t: string, retentionDays?: number) => relayFor({ [t]: noop }, retentionDays === undefined ? {} : { retentionDays });

describe("purging delivered rows", () => {
  it("deletes delivered rows past the retention and keeps the younger ones, at the edge too", async () => {
    const t = topic();
    await age(t, { deliveredDaysAgo: 8 });
    await age(t, { deliveredDaysAgo: 7.01 });
    await age(t, { deliveredDaysAgo: 6.99 });
    await age(t, { deliveredDaysAgo: 0.1 });

    const deleted = await purger(t, 7).purge();

    expect(deleted).toBe(2);
    expect(await remaining(t)).toBe(2);
  });

  it("never deletes a row that has not been delivered, or one that was parked, however old", async () => {
    const t = topic();
    await age(t, {}); // still waiting, created 30 days ago
    await age(t, { parked: true }); // parked 20 days ago: for a human

    expect(await purger(t, 1).purge()).toBe(0);
    expect(await remaining(t)).toBe(2);
  });

  it("only concerns the topics it has a consumer for: a delivered row of another topic is left to whoever owns it", async () => {
    const mine = topic();
    const theirs = topic();
    await age(mine, { deliveredDaysAgo: 30 });
    await age(theirs, { deliveredDaysAgo: 30 });

    const deleted = await purger(mine, 7).purge();

    expect(deleted).toBe(1);
    expect(await remaining(mine)).toBe(0);
    expect(await remaining(theirs)).toBe(1);
  });

  it("does nothing when retention is 0 or not set, or when it handles no topic at all", async () => {
    const t = topic();
    await age(t, { deliveredDaysAgo: 400 });

    expect(await purger(t, 0).purge()).toBe(0);
    expect(await purger(t).purge()).toBe(0);
    expect(await relayFor({}, { retentionDays: 7 }).purge()).toBe(0);
    expect(await remaining(t)).toBe(1);
  });

  it("deletes more rows than fit in one batch", async () => {
    const t = topic();
    await age(t, { count: 1200, deliveredDaysAgo: 30 });

    const deleted = await purger(t, 7).purge();

    expect(deleted).toBe(1200);
    expect(await remaining(t)).toBe(0);
  });

  it("is safe to run on several replicas at once: every row is deleted exactly once", async () => {
    const t = topic();
    await age(t, { count: 1200, deliveredDaysAgo: 30 });
    const relays = Array.from({ length: 3 }, () => purger(t, 7));

    const counts = await Promise.all(relays.map((each) => each.purge()));

    expect(counts.reduce((sum, n) => sum + n, 0)).toBe(1200);
    expect(await remaining(t)).toBe(0);
  });

  it("does not wait for rows another transaction holds: it deletes the rest and leaves those", async () => {
    const t = topic();
    await age(t, { count: 40, deliveredDaysAgo: 30 });
    const held = deferred();
    const locked = deferred();
    const holder = db().transaction(async (tx) => {
      await tx.execute(sql`select id from saas.outbox where topic = ${t} order by id limit 5 for update`);
      locked.resolve();
      await held.promise;
    });
    await locked.promise;

    const outcome = await Promise.race([purger(t, 7).purge(), new Promise<"waited">((resolve) => setTimeout(() => resolve("waited"), 2_000))]);
    held.resolve();
    await holder;

    expect(outcome).toBe(35);
    expect(await remaining(t)).toBe(5);
  });
});
