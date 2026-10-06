import type { RateLimitHit, RateLimitStore } from "./rate-limit.js";

export interface MemoryRateLimitStoreOptions {
  /** Most keys kept at once; past it the oldest are dropped, so a flood of distinct keys cannot grow memory without bound. Default 100 000. */
  maxKeys?: number;
  /** Clock, for tests. */
  now?: () => number;
}

/**
 * A rate-limit store in this process's memory. Fine for development, tests and a single instance. **Not shared**: each
 * replica counts on its own, so behind several the effective limit is the limit times the replicas, and a restart
 * forgets every count. Use a shared store (the docs show one for Postgres) in production.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  readonly #entries = new Map<string, RateLimitHit>();
  readonly #maxKeys: number;
  readonly #now: () => number;

  constructor(options: MemoryRateLimitStoreOptions = {}) {
    this.#maxKeys = options.maxKeys ?? 100_000;
    this.#now = options.now ?? Date.now;
  }

  hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const now = this.#now();
    const current = this.#entries.get(key);
    if (current && current.resetAt > now) {
      current.count += 1;
      return Promise.resolve({ ...current });
    }
    this.#entries.delete(key);
    if (this.#entries.size >= this.#maxKeys) {
      this.#sweep(now);
    }
    const fresh = { count: 1, resetAt: now + windowMs };
    this.#entries.set(key, fresh);
    return Promise.resolve({ ...fresh });
  }

  /** Drops ended windows, then the oldest keys if that was not enough. */
  #sweep(now: number): void {
    for (const [key, entry] of this.#entries) {
      if (entry.resetAt <= now) {
        this.#entries.delete(key);
      }
    }
    for (const key of this.#entries.keys()) {
      if (this.#entries.size < this.#maxKeys) {
        break;
      }
      this.#entries.delete(key);
    }
  }
}
