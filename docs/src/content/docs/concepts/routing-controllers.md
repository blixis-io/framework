---
title: Routing & Controllers
description: "@Controller, HTTP method decorators, and how the router matches a path."
sidebar:
  order: 5
---

`@blixis-io/http` turns `@Controller`-decorated classes into routes on an internal trie-based router, and wraps the whole thing into one `(Request) => Promise<Response>` function.

## `@Controller` and HTTP method decorators

```ts
import { Body, Controller, Delete, Get, Param, Post } from "@blixis-io/http";

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

`@Get`/`@Post`/`@Put`/`@Patch`/`@Delete` are the five supported HTTP methods. A class used as a controller **must** have `@Controller()` — a class listed in a module's `controllers` array without it throws `NotAControllerError` when the HTTP app is built. Registering the same method+path twice (two controllers, or two methods on one controller, that resolve to an identical route) throws `DuplicateRouteError` at the same point — the router never silently lets the second registration win.

## How a request is matched

The router is a segment trie, not a list of regexes checked in order. Each path segment is one of:

- **Static** — `posts`, `health` — matched exactly.
- **Param** — `:id` — matches any single segment, captured by name.
- **Wildcard** — `*` — matches and captures everything remaining in the path; must be the last segment.

Precedence when more than one pattern could match the same request is **static beats param beats wildcard**, evaluated per segment with backtracking — a static match that turns out to be a dead end (no route registered there **for this method**) doesn't block a param or wildcard route that *would* have matched:

```ts
@Get("new")     // static — wins for GET /posts/new
list() {}

@Get(":id")     // param — wins for GET /posts/42
get() {}
```

`GET /posts/new` matches the static route even though `:id` would also structurally match `"new"`; `GET /posts/42` falls through to the param route since there's no static `"42"`.

### Param names belong to the route

Each route keeps its own param names, so two methods may call the same position different things: `@Get(":id")` and `@Delete(":postId")` on `/posts/42` hand `"42"` to `@Param("id")` and `@Param("postId")` respectively. (Registering the same method on the same path twice is still a `DuplicateRouteError`, whatever the param is called.)

### Percent-encoding

The router matches the path **after decoding each segment once**, so what your handler receives is the decoded text:

| Request path | `@Param("id")` |
| --- | --- |
| `/posts/hello%20world` | `hello world` |
| `/posts/caf%C3%A9` | `café` |
| `/posts/a%2Fb` | `a/b` (one segment, so the slash stays inside the param) |
| `/posts/100%2520` | `100%20` (decoded once, not twice) |
| `/posts/a+b` | `a+b` (`+` is a space only in a query string) |

A static segment is matched against the decoded form too, so `@Get("café")` matches `/caf%C3%A9`. Don't decode params again in your handler: a literal `%` in the value would make a second `decodeURIComponent` throw. A path with a broken escape (`/posts/100%`, `/posts/%E0%A4%A`) is answered `400` with `Malformed percent-encoding in the request path`, before any guard or handler runs.

Because `%2F` decodes to a `/` *inside* the param, a handler that uses a param as a file path or a lookup key must still validate it; decoding doesn't make a value safe.

Empty segments are ignored, so `/posts/`, `//posts` and `/posts//42` reach the same routes as their tidy forms. That is deliberate leniency, not canonicalisation: a guard attached to a route sees the same request whichever spelling was used.

## What you get back

- **No route matches the path at all** → `404` (`application/problem+json`).
- **The path matches, but not for this method** → `405`, with an `Allow` header listing the methods registered on every route that matches the path. A route is only a match for the method it was registered with: with `@Post("new")` and `@Get(":id")` on `/posts`, `GET /posts/new` reaches `:id` (with `id = "new"`), and only `DELETE /posts/new` is a `405`, listing both `GET` and `POST`.
- **The path and method both match** → the controller method runs. See [Request Validation](/framework/concepts/request-validation/) for how its arguments are built, and [Error Handling](/framework/concepts/error-handling/) for exactly how the return value (or a thrown error) becomes a `Response`. For a redirect or a non-JSON content type, see the [Cookbook](/framework/examples/cookbook/#returning-a-raw-response-and-setting-a-content-type).

## Building the app

```ts
import { createHttpApplication } from "@blixis-io/http";

const app = await createHttpApplication(AppModule);
await app.listen(3000);
```

`createHttpApplication` wraps `@blixis-io/core`'s `createApplication` (see [Modules](/framework/concepts/modules/)) — it builds the module graph, then builds the router from `app.controllers`. If building the router fails (a duplicate route, say), the already-initialised providers are shut down before the error is thrown. `listen()` binds a real `node:http` server; `app.handle(request)` runs the same logic against an in-memory `Request` with no socket at all, which is what `@blixis-io/testing` uses (see [Testing](/framework/concepts/testing/)).

## Next

- What `@Body`/`@Query`/`@Param` actually do with each argument: [Request Validation](/framework/concepts/request-validation/).
- Denying a request before the controller method ever runs: [Guards & Authorization](/framework/concepts/guards-and-authorization/).
- Every exported symbol: [`@blixis-io/http` reference](/framework/reference/blixis-http/).
