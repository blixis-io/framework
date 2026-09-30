---
title: "Tutorial: Test-Driven API Development"
description: Add a new feature to the blog API test-first, using @blixis-io/testing's real-application testing.
sidebar:
  order: 3
---

This adds a search filter to the blog API from [Build Your First API](/framework/tutorials/build-your-first-api/) — `GET /posts?search=term` — entirely test-first: a failing test, the minimal code to pass it, then the next failing test. This is the same loop the framework's own test suite (165 tests, 100% coverage) was built with.

Tests use [Vitest](https://vitest.dev). If you haven't set it up in your app yet, see [Installation](/framework/start-here/installation/#if-youre-running-tests-with-vitest) for the required Oxc decorator config.

## Red: a unit test for the service

Start below the HTTP layer, at the plain class that does the actual work:

```ts title="src/posts/posts.service.test.ts"
import { describe, expect, it } from "vitest";
import { PostsService } from "./posts.service.js";

describe("PostsService.list", () => {
  it("returns every post when no search term is given", () => {
    const service = new PostsService();
    service.create({ title: "Hello World", body: "" });
    service.create({ title: "Second Post", body: "" });

    expect(service.list()).toHaveLength(2);
  });

  it("filters by a case-insensitive substring match on the title", () => {
    const service = new PostsService();
    service.create({ title: "Hello World", body: "" });
    service.create({ title: "Second Post", body: "" });

    const results = service.list("hello");

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Hello World");
  });
});
```

Run it:

```bash
pnpm vitest run
```

Both fail — `list()` doesn't accept an argument yet, and even ignoring that, it doesn't filter. That's expected; the test describes behavior that doesn't exist yet.

## Green: the minimal implementation

```ts title="src/posts/posts.service.ts" {1}
list(search?: string): Post[] {
  const posts = [...this.#posts.values()];
  if (!search) {
    return posts;
  }
  const term = search.toLowerCase();
  return posts.filter((post) => post.title.toLowerCase().includes(term));
}
```

Run the tests again — both pass. Nothing else in `PostsService` needed to change.

## Red: an end-to-end test through the real HTTP layer

The unit test proves the *service* filters correctly. It doesn't prove a request with `?search=` actually reaches it — that's a controller/routing concern, and it deserves its own test, through the real application:

```ts title="src/posts/posts.e2e.test.ts"
import { Test } from "@blixis-io/testing";
import { describe, expect, it } from "vitest";
import { PostsModule } from "./posts.module.js";

describe("GET /posts?search=", () => {
  it("filters results by the search query param", async () => {
    const app = await Test.createModule({ imports: [PostsModule] }).compile();

    await app.request("/posts", { method: "POST", json: { title: "Hello World" } });
    await app.request("/posts", { method: "POST", json: { title: "Second Post" } });

    const res = await app.request("/posts?search=hello");

    expect(res.status).toBe(200);
    const posts = (await res.json()) as Array<{ title: string }>;
    expect(posts).toHaveLength(1);
    expect(posts[0]?.title).toBe("Hello World");

    await app.close();
  });
});
```

This fails too, for a different reason than the unit test did: `PostsController.list()` doesn't read `?search=` from the query string at all yet, so it always returns everything.

## Green: wire the query param through

```ts title="src/posts/posts.controller.ts" {1}
import { Query } from "@blixis-io/http";
import { z } from "zod";

@Get()
list(@Query(z.object({ search: z.string().optional() })) query: { search?: string }) {
  return this.posts.list(query.search);
}
```

`@Query(schema)` parses and validates `req.url`'s search params into an object — see [Request Validation](/framework/concepts/request-validation/) — so `query.search` is already the right type by the time it reaches `this.posts.list()`. Run both test files again; everything's green.

## Why this order, not the reverse

Testing `PostsService` directly first — no `Test.createModule()`, no HTTP, just `new PostsService()` — caught the filtering *logic* with the fastest possible feedback loop: no DI container, no router, nothing to build. The end-to-end test through `Test.createModule()` then proved the *wiring* — that a real `?search=` query string actually reaches that logic through real routing and real param parsing. Both matter, and they catch different classes of mistake: a unit test can't catch "the query param is never read"; an end-to-end test alone would make you debug through three layers to find a filtering bug that a two-line unit test would have pinpointed immediately.

## Next

- What `Test.createModule().compile()` builds and why it's a *real* application, not a mock: [Testing](/framework/concepts/testing/).
- Swap in a fake dependency instead of exercising the real one: [Overriding Providers in Tests](/framework/guides/overriding-providers-in-tests/).
