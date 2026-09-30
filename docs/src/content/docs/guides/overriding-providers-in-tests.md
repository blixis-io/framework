---
title: Overriding Providers in Tests
description: Swap a real dependency for a fake without touching the module under test.
sidebar:
  order: 7
---

See [Testing](/framework/concepts/testing/#override) for the mechanism. This is when and how to reach for it.

## The problem it solves

`PostController` depends on `PostService`, which depends on `PostRepository`. Testing the controller's HTTP behavior — status codes, validation, response shape — shouldn't require a real database. `.override()` lets you keep the *real* `PostController` and `PostService` (so their actual logic runs) while swapping only `PostRepository` for something in-memory:

```ts
import { Test } from "@blixis-io/testing";

const fakeRepo = {
  findAll: () => [{ id: "1", title: "fake post" }],
  findById: (id: string) => ({ id, title: "fake post" }),
};

const app = await Test.createModule({ imports: [PostsModule] })
  .override(PostRepository, { useValue: fakeRepo })
  .compile();

const res = await app.request("/posts");
expect(await res.json()).toEqual([{ id: "1", title: "fake post" }]);
```

`PostController` and `PostService` are unmodified — the real routing, the real validation, the real response-shaping all run. Only the leaf dependency is fake.

## Overriding with a class instead of a value

If the fake needs its own internal state or behavior beyond a fixed return value, override with `useClass` instead of `useValue`:

```ts
class InMemoryPostRepository {
  #posts = new Map<string, Post>();
  findAll() { return [...this.#posts.values()]; }
  save(post: Post) { this.#posts.set(post.id, post); }
}

const app = await Test.createModule({ imports: [PostsModule] })
  .override(PostRepository, { useClass: InMemoryPostRepository })
  .compile();
```

`useFactory` and `useExisting` work too — the second argument to `.override()` is any provider shape minus `provide` (see [Dependency Injection](/framework/concepts/dependency-injection/#provider-kinds)).

## Asserting on the fake directly

`app.get(token)` returns whatever was actually resolved — the override, if one applies — which is often a more direct assertion than going through an HTTP response:

```ts
expect(app.get(PostRepository)).toBe(fakeRepo);
```

## When *not* to override

If the real `PostRepository` is already fast, deterministic, and side-effect-free (an in-memory implementation, like `examples/hello-api`'s), there's often nothing to gain from overriding it — the whole point of `Test.createModule()` is that it builds a *real* application, so prefer testing against the real thing until something (a real database, a real external API call) makes that impractical.
