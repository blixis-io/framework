import { Module, type DynamicModule } from "@blixis/core";
import { Injectable, InjectionToken } from "@blixis/di";

export type EventHandler<Payload> = (payload: Payload) => void | Promise<void>;

export interface EventBus<Events extends Record<string, unknown>> {
  emit<K extends keyof Events & string>(type: K, payload: Events[K]): Promise<void>;
  /** Registers `handler` for `type`, returning a function that unsubscribes just this handler. */
  on<K extends keyof Events & string>(type: K, handler: EventHandler<Events[K]>): () => void;
}

export interface EventsForRootOptions {
  /** Makes `EVENT_BUS` visible to every module without each one importing this one directly. Defaults to `false`. */
  global?: boolean;
}

/**
 * Runs every handler for an event concurrently and in-process — no
 * persistence, no delivery guarantee across a crash. Deliberately the only
 * implementation for now; see `concepts/events.md` for why a transactional
 * outbox was deferred rather than built ahead of a real consumer.
 */
@Injectable()
class InProcessEventBus<Events extends Record<string, unknown>> implements EventBus<Events> {
  readonly #handlers = new Map<string, Set<EventHandler<never>>>();

  on<K extends keyof Events & string>(type: K, handler: EventHandler<Events[K]>): () => void {
    let handlers = this.#handlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.#handlers.set(type, handlers);
    }
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  async emit<K extends keyof Events & string>(type: K, payload: Events[K]): Promise<void> {
    const handlers = this.#handlers.get(type);
    if (!handlers || handlers.size === 0) {
      return;
    }

    await Promise.all(
      [...handlers].map(async (handler) => {
        try {
          // Handlers for every event type share one Set<EventHandler<never>>
          // collection (indexed by the string `type`, not a type-level key),
          // so there's no way for TS to correlate a specific handler back to
          // the K it was registered with — this cast is the one place that
          // trusts `type` actually matches, same as `on()`'s own erasure.
          await handler(payload as never);
        } catch (error) {
          // A handler's own failure never blocks sibling handlers or the
          // caller — same self-contained fallback @blixis/logging's own
          // transport-failure handling already uses.
          console.error(`event handler for "${type}" failed:`, error);
        }
      }),
    );
  }
}

/**
 * Builds an `EVENT_BUS` token typed to one app's event map. Same
 * factory-closure shape as `defineConfigModule`/`defineAuthModule` — the
 * event-name-to-payload map is app-specific, so it's a generic parameter
 * fixed once per app, not baked into the package.
 */
export function defineEventsModule<Events extends Record<string, unknown>>(): {
  EventsModule: { forRoot(options?: EventsForRootOptions): DynamicModule };
  EVENT_BUS: InjectionToken<EventBus<Events>>;
} {
  const EVENT_BUS = new InjectionToken<EventBus<Events>>("blixis.events.bus");

  @Module()
  class EventsModule {
    static forRoot(options: EventsForRootOptions = {}): DynamicModule {
      return {
        module: EventsModule,
        providers: [{ provide: EVENT_BUS, useClass: InProcessEventBus }],
        exports: [EVENT_BUS],
        global: options.global ?? false,
      };
    }
  }

  return { EventsModule, EVENT_BUS };
}
