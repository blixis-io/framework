import type { OnApplicationShutdown, OnModuleInit } from "@blixis-io/core";
import { Inject, Injectable, InjectionToken } from "@blixis-io/di";
import { sql } from "drizzle-orm";
import { DATABASE, type Database } from "../db/index.js";
import { DEFAULT_HANDLERS, type OutboxHandler } from "./handlers.js";

export interface OutboxOptions {
  /** How long to wait when there is nothing to deliver. `0` does not start the loop (tests call `runOnce`). */
  pollMs: number;
  /** After this many failed deliveries an event is parked (`failed_at`) and never retried. */
  maxAttempts: number;
  /** How many events one pass claims. */
  batchSize?: number;
  /** Where a failure goes. A delivery failure never crashes the loop. */
  onError?: (error: unknown, event?: { id: string; topic: string; attempts: number }) => void;
  /** Topic to consumer. Default: the example's consumers. */
  handlers?: Readonly<Record<string, OutboxHandler>>;
}

export const OUTBOX_OPTIONS = new InjectionToken<OutboxOptions>("OUTBOX_OPTIONS");

interface Claimed extends Record<string, unknown> {
  id: string;
  topic: string;
  payload: unknown;
  attempts: number;
}

/**
 * Delivers the rows of `saas.outbox` **at least once**.
 *
 * One pass (`runOnce`) is one transaction: it claims due rows with `for update skip locked`, so any number of replicas can
 * run a relay and no row is handled by two at a time (the others skip it instead of waiting). Each row is handled inside a
 * savepoint: if its consumer throws, that row's writes are undone, the attempt is counted with a growing delay, and the rest
 * of the batch carries on. If the whole process dies mid-pass, the transaction rolls back and the rows are simply claimed again.
 * That is why delivery is at least once and why consumers must be idempotent (see `handlers.ts`).
 *
 * Trade-offs, on purpose: a consumer runs while its row is locked, so it should be quick and, as the example's is, write to
 * the same database. A consumer that calls a slow external service wants a different shape (claim, release, call, record),
 * which this example does not show. Order is not guaranteed across replicas or across retries.
 */
@Injectable()
export class OutboxRelay implements OnModuleInit, OnApplicationShutdown {
  readonly #handlers: Readonly<Record<string, OutboxHandler>>;
  #stopping = false;
  #loop: Promise<void> | undefined;
  #wake: (() => void) | undefined;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX_OPTIONS) private readonly options: OutboxOptions,
  ) {
    this.#handlers = options.handlers ?? DEFAULT_HANDLERS;
  }

  onModuleInit(): void {
    if (this.options.pollMs > 0) {
      this.#loop = this.#run();
    }
  }

  /** Stop claiming, and wait for the pass in flight to commit, before the pool closes. */
  async onApplicationShutdown(): Promise<void> {
    this.#stopping = true;
    this.#wake?.();
    await this.#loop;
  }

  /** Claims and delivers one batch. Returns how many events it handled (delivered or failed). */
  async runOnce(): Promise<number> {
    const { maxAttempts, batchSize = 20, onError } = this.options;
    // Only the topics this relay has a consumer for: a row for any other topic belongs to someone else and is left alone.
    const topics = Object.keys(this.#handlers);
    if (topics.length === 0) {
      return 0;
    }
    return this.db.transaction(async (tx) => {
      const claimed = await tx.execute<Claimed>(sql`
        select id, topic, payload, attempts from saas.outbox
        where processed_at is null and failed_at is null and available_at <= now()
          and topic in (${sql.join(topics.map((topic) => sql`${topic}`), sql`, `)})
        order by created_at
        limit ${batchSize}
        for update skip locked`);

      for (const event of claimed.rows) {
        try {
          const handler = this.#handlers[event.topic];
          if (!handler) {
            throw new Error(`no consumer for topic "${event.topic}"`);
          }
          // A savepoint: a throwing consumer undoes only its own writes, not the whole batch.
          await tx.transaction((inner) => handler(inner, { id: event.id, topic: event.topic, payload: event.payload }));
          await tx.execute(sql`update saas.outbox set processed_at = now(), last_error = null where id = ${event.id}`);
        } catch (error) {
          const attempts = event.attempts + 1;
          const message = error instanceof Error ? error.message : String(error);
          await tx.execute(sql`
            update saas.outbox set
              attempts = ${attempts},
              last_error = ${message.slice(0, 1000)},
              available_at = now() + interval '1 second' * least(power(2, ${attempts}), 300),
              failed_at = case when ${attempts} >= ${maxAttempts} then now() end
            where id = ${event.id}`);
          onError?.(error, { id: event.id, topic: event.topic, attempts });
        }
      }
      return claimed.rows.length;
    });
  }

  async #run(): Promise<void> {
    while (!this.#stopping) {
      let handled = 0;
      try {
        handled = await this.runOnce();
      } catch (error) {
        // The database itself failed (not a consumer): report it and back off like an empty pass.
        this.options.onError?.(error);
      }
      if (handled === 0 && !this.#stopping) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, this.options.pollMs);
          this.#wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
    }
  }
}
