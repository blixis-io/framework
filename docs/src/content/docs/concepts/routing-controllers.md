---
title: Routing & Controllers
description: "@Controller, HTTP method decorators, and how the router matches a path."
sidebar:
  order: 5
---

`@blixis/http` turns `@Controller`-decorated classes into routes on an internal trie-based router, and wraps the whole thing into one `(Request) => Promise<Response>` function.

## `@Controller` and HTTP method decorators

```ts
import { Body, Controller, Delete, Get, Param, Post } from "@blixis/http";

@Controller("posts")
export class PostController {
  constructor(private readonly posts: PostService) {}

  @Get()
  list() {
    return this.posts.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.posts.get(id);
  }

  @Post()
  create(@Body(CreatePostSchema) input: CreatePostInput) {
    return this.posts.create(input);
  }

  @Delete(":id")
  remove(@Param("id") id: string): undefined {
    this.posts.remove(id);
    return undefined;
  }
}
```

The controller's prefix (`"posts"`) and each method's path (`""`, `":id"`) are joined and normalized — leading/trailing slashes don't matter, so `@Controller("posts")` + `@Get(":id")` and `@Controller("/posts/")` + `@Get("/:id")` register the identical route.

`@Get`/`@Post`/`@Put`/`@Patch`/`@Delete` are the five supported HTTP methods. A class used as a controller **must** have `@Controller()` — a class listed in a module's `controllers` array without it throws `NotAControllerError` when the HTTP app is built.

## How a request is matched

The router is a segment trie, not a list of regexes checked in order. Each path segment is one of:

- **Static** — `posts`, `health` — matched exactly.
- **Param** — `:id` — matches any single segment, captured by name.
- **Wildcard** — `*` — matches and captures everything remaining in the path; must be the last segment.

Precedence when more than one pattern could match the same request is **static beats param beats wildcard**, evaluated per segment with backtracking — a static match that turns out to be a dead end (no route registered there) doesn't block a param or wildcard route that *would* have matched:

```ts
@Get("new")     // static — wins for GET /posts/new
list() {}

@Get(":id")     // param — wins for GET /posts/42
get() {}
```

`GET /posts/new` matches the static route even though `:id` would also structurally match `"new"`; `GET /posts/42` falls through to the param route since there's no static `"42"`.

## What you get back

- **No route matches the path at all** → `404` (`application/problem+json`).
- **The path matches, but not for this method** → `405`, with an `Allow` header listing the methods that *are* registered there.
- **The path and method both match** → the controller method runs. See [Request Validation](/concepts/request-validation/) for how its arguments are built, and [Error Handling](/concepts/error-handling/) for exactly how the return value (or a thrown error) becomes a `Response`.

## Building the app

```ts
import { createHttpApplication } from "@blixis/http";

const app = await createHttpApplication(AppModule);
await app.listen(3000);
```

`createHttpApplication` wraps `@blixis/core`'s `createApplication` (see [Modules](/concepts/modules/)) — it builds the module graph, then builds the router from `app.controllers`. `listen()` binds a real `node:http` server; `app.handle(request)` runs the same logic against an in-memory `Request` with no socket at all, which is what `@blixis/testing` uses (see [Testing](/concepts/testing/)).

## Next

- What `@Body`/`@Query`/`@Param` actually do with each argument: [Request Validation](/concepts/request-validation/).
- Denying a request before the controller method ever runs: [Guards & Authorization](/concepts/guards-and-authorization/).
- Every exported symbol: [`@blixis/http` reference](/reference/blixis-http/).
