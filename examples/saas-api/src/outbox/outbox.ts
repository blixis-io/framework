import { outbox } from "../db/schema.js";
import type { Database } from "../db/index.js";

/** The database or a transaction on it: the outbox row must be written with whatever the caller is already inside. */
export type Executor = Pick<Database, "insert">;

/**
 * Records an event. Call it **inside the same transaction** as the change the event describes: that is the whole
 * guarantee. Called with the plain database (outside a transaction) it still works, but then a crash between the change
 * and this insert loses the event, which is exactly what the outbox exists to prevent.
 */
export async function enqueue(executor: Executor, topic: string, payload: unknown): Promise<string> {
  const id = crypto.randomUUID();
  await executor.insert(outbox).values({ id, topic, payload });
  return id;
}
