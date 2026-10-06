---
title: Events
description: In-process domain event pub-sub — defineEventsModule(), EventBus, and why an outbox was deferred rather than built ahead of a real consumer.
sidebar:
  order: 19
---

`@blixis-io/events` is a small in-process publish/subscribe bus for domain events — `"post.created"`, `"user.invited"`, whatever your app's own event names are. It has nothing to do with HTTP: it depends only on `@blixis-io/core` and `@blixis-io/di`, the same category as [`@blixis-io/logging`](/framework/concepts/logging/) and [`@blixis-io/config`](/framework/concepts/config/), so it's usable in any app, HTTP or not.

## The shape

Same factory-closure pattern as [`@blixis-io/config`'s `defineConfigModule`](/framework/reference/blixis-config/) and [`@blixis-io/tenancy`'s `defineTenancyModule`](/framework/reference/blixis-tenancy/) — your app's event-name-to-payload map is a generic parameter fixed once per app, not baked into the package:

```ts
// events.ts
type AppEvents = {
  "post.created": { postId: string; title: string };
  "post.deleted": { postId: string };
};

export const { EventsModule, EVENT_BUS } = defineEventsModule<AppEvents>();
```

Use a `type` alias, not an `interface`, for the event map. An `interface` doesn't satisfy `defineEventsModule`'s `Record<string, unknown>` generic constraint — TypeScript doesn't give interfaces an implicit index signature even when every key is a string literal — so `defineEventsModule<AppEvents>()` fails to typecheck if `AppEvents` is declared with `interface`.

## Wiring it in

```ts
@Module({ imports: [EventsModule.forRoot({ global: true })] })
class AppModule {}
```

`global` defaults to `false`. Pass `true` to make `EVENT_BUS` resolvable from any module without each one importing `EventsModule` directly — reasonable for an app-wide event bus, since most modules that emit or listen for domain events aren't otherwise related to each other.

## Emitting and listening

```ts
@Injectable()
class PostsService {
  constructor(@Inject(EVENT_BUS) private readonly events: EventBus<AppEvents>) {}

  async create(input: CreatePostInput) {
    const post = await this.repo.insert(input);
    await this.events.emit("post.created", { postId: post.id, title: post.title });
    return post;
  }
}
```

```ts
@Injectable()
class SearchIndexer {
  constructor(@Inject(EVENT_BUS) events: EventBus<AppEvents>) {
    events.on("post.created", async (payload) => {
      await this.index(payload.postId);
    });
  }
}
```

`on()` returns a function that unsubscribes just that one handler, leaving any others registered for the same event type intact.

## `@OnEvent`: declare the handler instead

The factory also returns an `OnEvent` decorator typed to your event map. Put it on a method and the framework subscribes it for you, so a listener no longer needs the bus injected or a constructor:

```ts
// events.ts
export const { EventsModule, EVENT_BUS, OnEvent } = defineEventsModule<AppEvents>();
```

```ts
@Injectable()
class SearchIndexer {
  constructor(private readonly search: SearchClient) {}

  @OnEvent("post.created")
  async index(payload: AppEvents["post.created"]): Promise<void> {
    await this.search.add(payload.postId);
  }
}
```

The compiler checks the method: a parameter that doesn't match the event's payload, or an event name that isn't in the map, is a type error, not a runtime surprise. `this` is the provider, so injected dependencies work.

How it works, and what to know:

- After the application has booted, the events module scans every singleton provider (and controller) for `@OnEvent` methods, including ones inherited from a base class, and subscribes them. This uses the [`OnApplicationBootstrap`](/framework/concepts/lifecycle-hooks/#onapplicationbootstrap) hook. Handlers in any module are found, not only the module that imports `EventsModule`.
- Because the subscription happens **after** boot, an event emitted from an `onModuleInit` is not seen by `@OnEvent` handlers. Emit from request handling, or from `onApplicationBootstrap`.
- Transient providers are never cached, so their handlers are not subscribed. Use singleton providers (the default).
- Handlers are unsubscribed when the application closes.
- Failure behaviour is the same as `on()`: a handler that throws is reported (see below) and doesn't affect the others or the emitter.
- Two `defineEventsModule()` calls in one app keep separate handlers: each decorator only feeds its own bus.
- `@OnEvent` on something that isn't a method fails the boot with the class and member name.

## What `emit()` actually does — and doesn't

The only implementation, `InProcessEventBus`, runs every handler registered for an event **concurrently**, and `emit()` resolves once all of them have settled — success or failure. A handler that throws (or an async handler whose promise rejects) is caught individually: it's reported, but it never stops sibling handlers from running and never makes `emit()` itself reject. There's no ordering guarantee between handlers for the same event.

By default the report is `console.error`. To send it to your logger, pass `onHandlerError` to `forRoot()`: `EventsModule.forRoot({ onHandlerError: ({ type, error }) => logger.error("event handler failed", { type, err: error }) })`. It also receives the `payload` the handler was given, which may hold personal data: log only what you need. A hook that throws does not fail `emit()` either; both failures are written to `console.error`.

This means:

- **No persistence.** An event emitted with no process alive to receive it (or a process that crashes mid-handler) is gone. There's no queue, no retry, no at-least-once delivery.
- **No durability across a crash.** If the process dies between writing a domain change to the database and calling `emit()`, the event is lost — the write and the emit aren't in the same transaction.
- **No cross-process delivery.** Handlers only see events emitted in the same process. This is a pub-sub bus for one running app, not a message broker.

## Why not build the outbox pattern now

The old CMS this framework's `bundle-cms` rebuild is replacing used an **outbox pattern**: write the domain event in the same database transaction as the domain change it describes, so a crash between the two can never lose the event, then dispatch it out-of-band. That's a real, valuable guarantee — and deliberately not what's built here yet.

Building it now would mean designing table ownership, a dispatcher, and retry/idempotency semantics against a *hypothetical* consumer — no code in this framework or `bundle-cms` yet needs the durability guarantee enough to justify that design surface. The in-process bus is what today's consumers (search indexing, cache invalidation, webhooks fired best-effort) actually need. When `bundle-cms`'s `content` or `webhooks` modules reach a point where losing an event on crash is unacceptable, that's the point to design the outbox — against real requirements instead of guessed ones.

If you're building something today that truly can't tolerate losing an event, don't reach for this package as-is: write directly to your own outbox table in the same transaction as the domain change, and dispatch it yourself.

## Next

- Every exported symbol: [`@blixis-io/events` reference](/framework/reference/blixis-events/).
- The same factory-closure pattern used elsewhere: [`@blixis-io/config`](/framework/reference/blixis-config/), [`@blixis-io/tenancy`](/framework/reference/blixis-tenancy/).
