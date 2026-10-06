---
title: "@blixis-io/events"
description: Full API reference for the events package.
sidebar:
  order: 13
---

In-process domain event pub-sub. See [Events](/framework/concepts/events/) for the concepts and why a transactional outbox was deferred.

## `defineEventsModule`

```ts
function defineEventsModule<Events extends Record<string, unknown>>(): {
  EventsModule: { forRoot(options?: EventsForRootOptions): DynamicModule };
  EVENT_BUS: InjectionToken<EventBus<Events>>;
  OnEvent: <K extends keyof Events & string>(
    type: K,
  ) => <T extends (payload: Events[K]) => void | Promise<void>>(
    target: object,
    method: string | symbol,
    descriptor: TypedPropertyDescriptor<T>,
  ) => void;
};

interface EventsForRootOptions {
  global?: boolean; // default false
  onHandlerError?: (failure: EventHandlerFailure) => void; // default: console.error
}

interface EventHandlerFailure {
  type: string; // the event
  error: unknown; // what the handler threw or rejected with
  payload: unknown; // what it was given; may hold personal data
}
```

Same factory-closure shape as [`@blixis-io/config`'s `defineConfigModule`](/framework/reference/blixis-config/), [`@blixis-io/auth`'s `defineAuthModule`](/framework/reference/blixis-auth/), and [`@blixis-io/tenancy`'s `defineTenancyModule`](/framework/reference/blixis-tenancy/) — call it once per app (typically in its own `events.ts`), export the result. `Events` is your app's own event-name-to-payload map, declared with `type`, not `interface` — an `interface` doesn't satisfy the `Record<string, unknown>` constraint. Each call to `defineEventsModule()` produces its own distinct `EVENT_BUS` token.

`OnEvent(type)` decorates a method of any singleton provider: the decorated method must accept `Events[type]`, which the compiler checks. The subscription is made once the application has booted (via `OnApplicationBootstrap`) and removed when it closes. See [`@OnEvent`](/framework/concepts/events/#onevent-declare-the-handler-instead).

## `EventBus<Events>`

```ts
interface EventBus<Events extends Record<string, unknown>> {
  emit<K extends keyof Events & string>(type: K, payload: Events[K]): Promise<void>;
  on<K extends keyof Events & string>(type: K, handler: EventHandler<Events[K]>): () => void;
}

type EventHandler<Payload> = (payload: Payload) => void | Promise<void>;
```

Resolve it via `@Inject(EVENT_BUS)`, typed as `EventBus<AppEvents>`.

### `emit(type, payload)`

Runs every handler registered for `type` concurrently. Resolves once all of them have settled, whether they succeeded or threw — `emit()` itself never rejects. A handler with no listeners resolves immediately as a no-op. Each handler's own failure is caught individually and handed to `onHandlerError` (by default written with `console.error`) without affecting sibling handlers or the caller. A hook that throws is caught too, and both failures are written to `console.error`.

No persistence, no delivery guarantee across a process crash, no cross-process delivery — see [Events](/framework/concepts/events/#what-emit-actually-does--and-doesnt) for what this does and doesn't guarantee.

### `on(type, handler)`

Registers `handler` for `type`. Returns a function that unsubscribes just that one handler, leaving any others registered for the same event type intact.

## `EventsModule.forRoot(options?)`

```ts
@Module({ imports: [EventsModule.forRoot({ global: true })] })
class AppModule {}
```

Registers `EVENT_BUS` as a provider. `global` defaults to `false`; pass `true` to make `EVENT_BUS` resolvable from any module without each one importing `EventsModule` directly.

## `InProcessEventBus`

The only `EventBus` implementation this package ships. Not exported — resolve `EVENT_BUS` instead of referencing the class directly. A Map-of-Sets keyed by event type, no persistence layer, no external dependency beyond `@blixis-io/core`/`@blixis-io/di`.
