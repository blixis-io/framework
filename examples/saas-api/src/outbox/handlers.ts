import { z } from "zod";
import { activity } from "../db/schema.js";
import type { Executor } from "./outbox.js";

export interface OutboxEvent {
  id: string;
  topic: string;
  payload: unknown;
}

/** A consumer. It runs inside the transaction that marks the event delivered, and it must be safe to run twice. */
export type OutboxHandler = (tx: Executor, event: OutboxEvent) => Promise<void>;

export const ProjectCreatedPayload = z.object({
  projectId: z.uuid(),
  title: z.string(),
  organizationId: z.uuid(),
  spaceId: z.uuid(),
});

/**
 * The example consumer. **Idempotent by a natural key:** `event_id` is unique and the insert ignores a conflict, so
 * delivering the same event any number of times (a crash after the write but before the delivery was recorded, a retry,
 * two replicas) leaves one row. Delivery is *at least once*, never exactly once: every consumer has to be built like this.
 */
const projectCreated: OutboxHandler = async (tx, event) => {
  const payload = ProjectCreatedPayload.parse(event.payload);
  await tx
    .insert(activity)
    .values({
      id: crypto.randomUUID(),
      eventId: event.id,
      organizationId: payload.organizationId,
      spaceId: payload.spaceId,
      message: `Project "${payload.title}" was created`,
    })
    .onConflictDoNothing({ target: activity.eventId });
};

export const DEFAULT_HANDLERS: Readonly<Record<string, OutboxHandler>> = { "project.created": projectCreated };
