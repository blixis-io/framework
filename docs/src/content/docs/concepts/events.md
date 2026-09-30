---
title: Events
description: In-process domain event pub-sub — defineEventsModule(), EventBus, and why an outbox was deferred rather than built ahead of a real consumer.
sidebar:
  order: 19
---

`@blixis/events` is a small in-process publish/subscribe bus for domain events — `"post.created"`, `"user.invited"`, whatever your app's own event names are. It has nothing to do with HTTP: it depends only on `@blixis/core` and `@blixis/di`, the same category as [`@blixis/logging`](/concepts/logging/) and [`@blixis/config`](/concepts/config/), so it's usable in any app, HTTP or not.

## The shape

Same factory-closure pattern as [`@blixis/config`'s `defineConfigModule`](/reference/blixis-config/) and [`@blixis/tenancy`'s `defineTenancyModule`](/reference/blixis-tenancy/) — your app's event-name-to-payload map is a generic parameter fixed once per app, not baked into the package:

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

## What `emit()` actually does — and doesn't

The only implementation, `InProcessEventBus`, runs every handler registered for an event **concurrently**, and `emit()` resolves once all of them have settled — success or failure. A handler that throws (or an async handler whose promise rejects) is caught individually: it's logged, but it never stops sibling handlers from running and never makes `emit()` itself reject. There's no ordering guarantee between handlers for the same event.

This means:

- **No persistence.** An event emitted with no process alive to receive it (or a process that crashes mid-handler) is gone. There's no queue, no retry, no at-least-once delivery.
- **No durability across a crash.** If the process dies between writing a domain change to the database and calling `emit()`, the event is lost — the write and the emit aren't in the same transaction.
- **No cross-process delivery.** Handlers only see events emitted in the same process. This is a pub-sub bus for one running app, not a message broker.

## Why not build the outbox pattern now

The old CMS this framework's `bundle-cms` rebuild is replacing used an **outbox pattern**: write the domain event in the same database transaction as the domain change it describes, so a crash between the two can never lose the event, then dispatch it out-of-band. That's a real, valuable guarantee — and deliberately not what's built here yet.

Building it now would mean designing table ownership, a dispatcher, and retry/idempotency semantics against a *hypothetical* consumer — no code in this framework or `bundle-cms` yet needs the durability guarantee enough to justify that design surface. The in-process bus is what today's consumers (search indexing, cache invalidation, webhooks fired best-effort) actually need. When `bundle-cms`'s `content` or `webhooks` modules reach a point where losing an event on crash is unacceptable, that's the point to design the outbox — against real requirements instead of guessed ones.

If you're building something today that truly can't tolerate losing an event, don't reach for this package as-is: write directly to your own outbox table in the same transaction as the domain change, and dispatch it yourself.

## Next

- Every exported symbol: [`@blixis/events` reference](/reference/blixis-events/).
- The same factory-closure pattern used elsewhere: [`@blixis/config`](/reference/blixis-config/), [`@blixis/tenancy`](/reference/blixis-tenancy/).
