# `@blixis-io/events`

An in-process domain event bus (`defineEventsModule`, `EventBus.emit`/`on`). Depends only on `@blixis-io/core` — usable in any app, HTTP or not.

```bash
npm install @blixis-io/events @blixis-io/core @blixis-io/di
```

```ts
// events.ts
type AppEvents = {
  "post.created": { postId: string; title: string };
};

export const { EventsModule, EVENT_BUS } = defineEventsModule<AppEvents>();
```

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

Runs every handler for an event concurrently, in-process — no persistence, no delivery guarantee across a crash. Deliberately the only implementation for now; see the docs for why a transactional outbox was deferred rather than built ahead of a real need.

Part of [Blixis Framework](https://github.com/blixis-io/framework) — full docs: [Events](https://blixis-io.github.io/framework/concepts/events/) · [API reference](https://blixis-io.github.io/framework/reference/blixis-events/).
