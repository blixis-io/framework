import { Injectable } from "@blixis-io/di";
import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<Map<string, unknown>>();

/** Thrown by `RequestContext.set()` when called outside an active request scope. */
export class RequestContextError extends Error {
  constructor() {
    super("RequestContext.set() can only be called while handling a request.");
    this.name = "RequestContextError";
  }
}

/**
 * Per-request key/value store. Injectable as a singleton because its
 * methods don't hold state themselves — they read/write whichever
 * `Map` `runInRequestContext` made current for the request now being
 * handled, via `AsyncLocalStorage`. Reading (`get`/`has`) outside a
 * request is a legitimate "no request" answer; writing isn't, so
 * `set()` throws instead of silently doing nothing.
 */
@Injectable()
export class RequestContext {
  get<T = unknown>(key: string): T | undefined {
    return storage.getStore()?.get(key) as T | undefined;
  }

  has(key: string): boolean {
    return storage.getStore()?.has(key) ?? false;
  }

  set(key: string, value: unknown): void {
    const store = storage.getStore();
    if (!store) {
      throw new RequestContextError();
    }
    store.set(key, value);
  }
}

/** Runs `fn` with a fresh, isolated store current for its whole async call chain — what `createHandler` wraps around each request. */
export function runInRequestContext<T>(fn: () => T): T {
  return storage.run(new Map(), fn);
}

/** Stores started by `runInUnclaimedRequestContext` that no handler has adopted yet. */
const unclaimed = new WeakSet<Map<string, unknown>>();

/**
 * Starts a request scope for code that runs *around* the handler (middleware), which the handler then adopts
 * instead of starting its own, so what the middleware stored is what the guards and the controller read.
 */
export function runInUnclaimedRequestContext<T>(fn: () => T): T {
  const store = new Map<string, unknown>();
  unclaimed.add(store);
  return storage.run(store, fn);
}

/**
 * What `createHandler` wraps around each request: adopts the scope a middleware started (once, so a request made from
 * inside a handler, such as `app.handle()` for a sub-request, still gets a store of its own), or starts a fresh one.
 */
export function claimOrRunInRequestContext<T>(fn: () => T): T {
  const store = storage.getStore();
  if (store && unclaimed.delete(store)) {
    return fn();
  }
  return runInRequestContext(fn);
}
