---
title: Testing
description: "@blixis/testing: Test.createModule().override().compile(), and the request() helper."
sidebar:
  order: 9
---

`@blixis/testing` builds a real application — real DI container, real router, real validation — in a test, with two conveniences on top: swapping specific providers for fakes, and a `request()` helper that skips building `Request`/`URL` objects by hand.

## `Test.createModule().compile()`

```ts
import { Test } from "@blixis/testing";

const app = await Test.createModule({ imports: [PostsModule] }).compile();

const res = await app.request("/posts");
expect(res.status).toBe(200);

await app.close();
```

`createModule()` takes the same shape as `@Module({...})` — `imports`, `providers`, `controllers` — and wraps it in a synthetic root module. `compile()` builds a full `HttpApplication` from it, exactly the way `createHttpApplication` would in production (see [Routing & Controllers](/concepts/routing-controllers/)); nothing about request handling, validation, or guards is mocked.

## `.override()`

Replace one provider with a fake before the module graph resolves:

```ts
const fakeRepo = { findAll: () => ["fake-1"] };

const app = await Test.createModule({ imports: [PostsModule] })
  .override(PostRepository, { useValue: fakeRepo })
  .compile();
```

The second argument is any provider shape minus `provide` (`{ useValue }`, `{ useClass }`, `{ useFactory, inject? }`, or `{ useExisting }`) — see [Dependency Injection](/concepts/dependency-injection/#provider-kinds). `.override()` is chainable and can be called more than once for different tokens. Overriding a token nothing in the graph actually uses is a silent no-op, not an error — worth double-checking the token matches if an override doesn't seem to take effect.

## `.request()`

```ts
const res = await app.request("/posts", {
  method: "POST",
  json: { title: "hi" },
});
```

This is sugar over `app.handle(new Request(...))` — no socket involved, so tests run fast and don't need to manage a port. `path` is resolved against `http://localhost`, so a bare path like `/posts` just works. The `json` option JSON-stringifies its value into the body and sets `content-type: application/json` automatically; anything else `Request`'s own `init` accepts (`method`, `headers`, a raw `body`) passes straight through.

## `.get()` and `.close()`

```ts
app.get(PostRepository); // the resolved instance — the fake, if you overrode it
await app.close();       // runs OnApplicationShutdown hooks
```

`.get()` is useful for asserting on injected state directly rather than only through HTTP responses — the override example above could confirm the swap with `expect(app.get(PostRepository)).toBe(fakeRepo)`.

## Next

- A full TDD walkthrough building a new endpoint: [Test-Driven API Development](/tutorials/test-driven-api-development/).
- More detail on when and why to override: [Overriding Providers in Tests](/guides/overriding-providers-in-tests/).
- Every exported symbol: [`@blixis/testing` reference](/reference/blixis-testing/).
