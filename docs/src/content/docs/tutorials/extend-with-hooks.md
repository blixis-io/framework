---
title: "Tutorial: Extend Behavior with Method Hooks"
description: Add before/after/around behavior to a service method without touching its body, using @blixis/method-hooks.
sidebar:
  order: 4
---

This continues the blog API from [Build Your First API](/tutorials/build-your-first-api/) and [Add Authentication](/tutorials/add-authentication/). We'll add logging, input normalization, and timing to `PostsService.create()` — without changing a single line inside it. Read [Method Hooks](/concepts/method-hooks/) alongside this if the stacking order isn't clear from the example alone.

## 1. Add the dependency

```json title="package.json"
{
  "dependencies": {
    "@blixis/method-hooks": "workspace:*"
  }
}
```

`@blixis/method-hooks` has no dependency on `@blixis/core` or `@blixis/http` — it works on any class, `@Injectable()` or not. Nothing to wire into a module; `@Before`/`@After`/`@Around` are just method decorators.

## 2. `@Before` — normalize and log the attempt

```ts title="src/posts/posts.service.ts" ins={1,7-10}
import { Before } from "@blixis/method-hooks";
// ...other imports

@Injectable()
export class PostsService {
  @Before((input: CreatePostInput) => {
    console.log("creating post:", input.title);
    return [{ ...input, title: input.title.trim() }];
  })
  create(input: CreatePostInput): Post {
    const id = String(this.#nextId++);
    const post: Post = { id, title: input.title, body: input.body, createdAt: new Date().toISOString() };
    this.#posts.set(id, post);
    return post;
  }

  // ...list/get/update/remove unchanged
}
```

The hook returns an array (`[newInput]`) — that becomes `create`'s actual argument, so a title of `"  hi  "` reaches `create` as `"hi"`. `create` itself never changed; it has no idea its input was trimmed before it saw it.

## 3. `@After` — shape the response

```ts title="src/posts/posts.service.ts" ins={1,8-11}
import { After, Before } from "@blixis/method-hooks";
// ...other imports

@Injectable()
export class PostsService {
  @Before((input: CreatePostInput) => {
    console.log("creating post:", input.title);
    return [{ ...input, title: input.title.trim() }];
  })
  @After((result: Post) => {
    console.log("post created:", result.id);
    return result;
  })
  create(input: CreatePostInput): Post {
    // ...unchanged
  }
}
```

`@After`'s hook must return the result — here it's unchanged, just observed, but it could just as easily return a modified copy (adding a computed field, redacting something) without `create` knowing that happened either.

## 4. `@Around` — time it

```ts title="src/posts/posts.service.ts" ins={1,12-17}
import { After, Around, Before } from "@blixis/method-hooks";
// ...other imports

@Injectable()
export class PostsService {
  @Before((input: CreatePostInput) => {
    console.log("creating post:", input.title);
    return [{ ...input, title: input.title.trim() }];
  })
  @After((result: Post) => {
    console.log("post created:", result.id);
    return result;
  })
  @Around((next: (input: CreatePostInput) => Post, input: CreatePostInput) => {
    const start = performance.now();
    const result = next(input);
    console.log("create took", Math.round(performance.now() - start), "ms");
    return result;
  })
  create(input: CreatePostInput): Post {
    // ...unchanged
  }
}
```

## 5. Try it

```bash
curl -X POST localhost:3000/posts -H 'content-type: application/json' -d '{"title": "  hello world  "}'
```

Console output, in this order:

```
creating post:   hello world  
create took 0 ms
post created: 1
```

The first line logs the **untrimmed** title — `@Before`'s hook receives the original arguments and only replaces them for the call it makes *after* logging. The response body's title is `"hello world"` (trimmed), since that's what `create` itself actually received.

Matches [Method Hooks#stacking-order](/concepts/method-hooks/#stacking-order): `@Before` (topmost) runs first; `@Around` (bottommost, closest to `create`) wraps the actual call, so its own pre/post logic sits right against the real work; `@After` runs last, once everything inward has returned.

## 6. Test the call order directly

```ts title="src/posts/posts.service.test.ts"
import { describe, expect, it, vi } from "vitest";
import { PostsService } from "./posts.service.js";

describe("PostsService.create hooks", () => {
  it("trims the title before create runs, in the order before → around → after", () => {
    const log: string[] = [];
    const service = new PostsService();
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => log.push(String(args[0])));

    const result = service.create({ title: "  hi  ", body: "" });

    expect(result.title).toBe("hi");
    expect(log).toEqual(["creating post:", "create took", "post created:"]);
  });
});
```

No mocking of `@blixis/method-hooks` itself — this is the real `PostsService`, decorated exactly as it runs in production, asserting on real console output. Same "test the real thing" approach as [Test-Driven API Development](/tutorials/test-driven-api-development/).

## Next

- The exact stacking-order rule these three decorators follow when combined: [Method Hooks](/concepts/method-hooks/).
- Every exported symbol: [`@blixis/method-hooks` reference](/reference/blixis-method-hooks/).
