---
title: The transactional outbox
description: Write an event in the same database transaction as the change it describes, deliver it afterwards at least once, and build consumers that survive a repeat. A worked example, with what is tested and what is not.
sidebar:
  order: 8.9
---

The in-process [event bus](/framework/concepts/events/) loses an event if the process dies between writing a change and emitting it. When losing the event is not acceptable (a customer must be told, another system must hear of it), use an **outbox**: the event is a database row, written **in the same transaction** as the change, and a relay delivers the rows afterwards.

The framework ships no outbox package, on purpose: the parts are small and mostly *your* decisions (the table, who consumes, what a retry means). `examples/saas-api` is a worked, tested example you can copy; it is a few hundred lines with its migration and comments.

## The shape

| Part | In `examples/saas-api` | What it guarantees |
| --- | --- | --- |
| The table | `migrations/0002_outbox.sql` | A row per event, a due time, an attempt count, `processed_at`, `failed_at`. A partial index holds only the rows still waiting, so it stays small. |
| Writing | `src/outbox/outbox.ts` (`enqueue`) used in `ProjectsService.create` | The project and its event are one transaction: both happen or neither does. |
| Delivery | `src/outbox/outbox-relay.ts` (`OutboxRelay`) | **At least once.** A pass claims due rows with `for update skip locked`, so any number of replicas can run a relay and no row is handled by two at the same time. |
| A consumer | `src/outbox/handlers.ts` | **Idempotent.** It writes with a unique `event_id` and ignores a conflict, so a repeat leaves one result. |

```ts
// The change and the event are one transaction. Outside a transaction this protects nothing.
return this.db.transaction(async (tx) => {
  const [project] = await tx.insert(projects).values({ /* ... */ }).returning();
  await enqueue(tx, "project.created", { projectId: project.id, title: project.title, /* ... */ });
  return project;
});
```

## What the relay does with failure

- Each event runs inside a **savepoint**. A consumer that throws undoes only its own writes; the attempt is counted, the event gets a growing delay (2, 4, 8 ... up to 300 s), and the rest of the batch carries on.
- After `OUTBOX_MAX_ATTEMPTS` (default 5) the event is **parked** (`failed_at`) and never retried. Parked rows are for a human: look for them (`select * from saas.outbox where failed_at is not null`) and alert on them.
- If the whole process dies in the middle of a pass, the transaction rolls back and the rows are claimed again. That is **why delivery is at least once and not exactly once**: a consumer may see the same event twice, so it has to be safe to run twice.
- A relay only claims the topics it has a consumer for. A row for another topic belongs to someone else and is left alone, so several services can share one table.
- A failure of the database itself is reported through `onError` and the loop backs off; it does not crash the process. On shutdown the loop stops and the pass in flight commits before the pool closes.

## Trade-offs the example makes, so check them against your case

- **A consumer runs while its row is locked.** Keep it quick and, as the example's is, have it write to the same database. A consumer that calls a slow external service (an email provider, a webhook) wants a different shape: claim the row and set a lease, release the transaction, make the call, record the result. This example does not show that.
- **Order is not guaranteed** across replicas or across retries. If order matters for one entity, carry a version in the payload and make the consumer ignore anything older.
- **The table would grow without a purge.** The relay deletes delivered rows older than `OUTBOX_RETENTION_DAYS` (default 14; `0` keeps them forever), once an hour (`OUTBOX_PURGE_INTERVAL_MS`; the first purge is an hour after start, not at boot), 500 rows at a time with `skip locked`, so replicas can purge together and no statement holds many locks for long. A partial index on `processed_at` (migration `0004`) keeps it from scanning the table. It only concerns the topics the relay consumes, like delivery does, and it **never deletes parked rows or rows still waiting**: those are for a human. The activity the consumer wrote is not touched; it has a lifetime of its own. Pick a retention long enough to investigate a delivery problem and to let you replay an event by clearing its `processed_at`.
- **Polling, not push.** `OUTBOX_POLL_MS` (default 1000) is the worst-case added latency when idle. `0` turns the loop off in a process (run the relay in a worker, or in tests). `LISTEN/NOTIFY` could wake it sooner; the example does not.
- **Payloads are stored as written.** Do not put secrets in an event, and mind personal data and your retention rules.

## Tested, and not

Tested against a real Postgres (`src/outbox.test.ts`, `src/outbox.e2e.test.ts`): the event written with the change and absent when the change fails (through the service, with a trigger that refuses one event); delivery visible through the API; redelivery leaving one result; a failing consumer counted, backed off and its writes undone, then delivered; one failing event not stopping its batch; parking after the attempt limit; unknown topics left alone; four relays on 40 events delivering each exactly once; the loop delivering by itself and stopping on close. Each guarantee was checked by removing the line that provides it and watching a test fail (the lock, the savepoint, the conflict clause, the shared transaction).

Purging is tested too: the edge of the retention, rows that must never go (waiting, parked, another topic's), more than one batch, three replicas purging at once with every row deleted exactly once, a purge that does not wait on rows another transaction holds, and the loop purging by itself; each of those was checked by breaking the line behind it.

Not tested: a real crash in the middle of a pass (the redelivery test sets the row due again, which is the same state), very large tables (a purge of millions of rows), a long-running consumer, Postgres failover, and `LISTEN/NOTIFY`.
