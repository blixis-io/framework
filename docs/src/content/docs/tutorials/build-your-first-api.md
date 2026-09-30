---
title: "Tutorial: Build Your First API"
description: From an empty directory to a running blog API with full CRUD and validation.
sidebar:
  order: 1
---

This tutorial builds a small blog API — posts with a title and body, full CRUD, validated with Zod — from nothing. It's the same shape as the framework's own `examples/hello-api` (see the [annotated walkthrough](/framework/examples/hello-api-walkthrough/) of that exact code if you want to compare), but built up step by step so you understand *why* each piece exists, not just that it works.

If you haven't yet, do the [Quickstart](/framework/start-here/quickstart/) first — it covers the one-time app setup (`package.json`, `tsconfig.build.json`) this tutorial assumes.

## What we're building

- `GET /posts` — list all posts
- `GET /posts/:id` — get one post
- `POST /posts` — create a post, validated
- `PATCH /posts/:id` — partially update a post
- `DELETE /posts/:id` — delete a post

All in-memory — no database — so the only things doing real work are the framework itself.

## 1. The schema

Start with the shape of the data, since everything else depends on it:

```ts title="src/posts/post.schema.ts"
import { z } from "zod";

export const CreatePostSchema = z.object({
  title: z.string().min(1),
  body: z.string().default(""),
});
export type CreatePostInput = z.infer<typeof CreatePostSchema>;

export const UpdatePostSchema = CreatePostSchema.partial();
export type UpdatePostInput = z.infer<typeof UpdatePostSchema>;

export interface Post {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}
```

`Post` (the stored shape, with `id`/`createdAt`) is a plain interface, not a Zod schema — nothing external ever sends us a `Post`, so there's nothing to validate on the way in. `CreatePostSchema` and `UpdatePostSchema` are what we validate against; `.infer` keeps their TypeScript types locked to the schema.

## 2. The service

```ts title="src/posts/posts.service.ts"
import { Injectable } from "@blixis-io/di";
import { NotFoundException } from "@blixis-io/http";
import type { CreatePostInput, Post, UpdatePostInput } from "./post.schema.js";

@Injectable()
export class PostsService {
  readonly #posts = new Map<string, Post>();
  #nextId = 1;

  list(): Post[] {
    return [...this.#posts.values()];
  }

  get(id: string): Post {
    const post = this.#posts.get(id);
    if (!post) {
      throw new NotFoundException(`Post ${id} not found`);
    }
    return post;
  }

  create(input: CreatePostInput): Post {
    const id = String(this.#nextId++);
    const post: Post = { id, title: input.title, body: input.body, createdAt: new Date().toISOString() };
    this.#posts.set(id, post);
    return post;
  }

  update(id: string, input: UpdatePostInput): Post {
    const existing = this.get(id);
    const updated: Post = {
      ...existing,
      title: input.title ?? existing.title,
      body: input.body ?? existing.body,
    };
    this.#posts.set(id, updated);
    return updated;
  }

  remove(id: string): void {
    this.get(id); // throws NotFoundException if it doesn't exist
    this.#posts.delete(id);
  }
}
```

Two things worth noticing: `get()` throwing `NotFoundException` means every caller — the controller, and `update`/`remove` reusing `get()` — gets consistent 404 behavior for free, with no repeated existence checks. And `update()` resolves each optional field explicitly with `??` rather than spreading `input` over `existing` — see [Validating Request Bodies with Zod](/framework/guides/validating-request-bodies/#3-handle-a-partial-update-correctly) for why that distinction matters.

`@Injectable()` here isn't optional even though this service takes no constructor parameters of its own — it's what makes `PostsService` *itself* injectable into things that depend on it (the controller, next).

## 3. The controller

```ts title="src/posts/posts.controller.ts"
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@blixis-io/http";
import { CreatePostSchema, UpdatePostSchema, type CreatePostInput, type UpdatePostInput } from "./post.schema.js";
import { PostsService } from "./posts.service.js";

@Controller("posts")
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  list() {
    return this.posts.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.posts.get(id);
  }

  @Post()
  @HttpCode(201)
  create(@Body(CreatePostSchema) input: CreatePostInput) {
    return this.posts.create(input);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body(UpdatePostSchema) input: UpdatePostInput) {
    return this.posts.update(id, input);
  }

  @Delete(":id")
  remove(@Param("id") id: string): undefined {
    this.posts.remove(id);
    return undefined;
  }
}
```

`this.posts` is never assigned by hand — the container sees `PostsController`'s constructor parameter is typed `PostsService`, finds it registered (next step), and builds one to pass in. `@HttpCode(201)` overrides `create`'s default `200`; `remove` returns `undefined`, which the framework turns into `204 No Content` with no body.

## 4. The module

```ts title="src/posts/posts.module.ts"
import { Module } from "@blixis-io/core";
import { PostsController } from "./posts.controller.js";
import { PostsService } from "./posts.service.js";

@Module({
  providers: [PostsService],
  controllers: [PostsController],
})
export class PostsModule {}
```

```ts title="src/app.module.ts"
import { Module } from "@blixis-io/core";
import { PostsModule } from "./posts/posts.module.js";

@Module({ imports: [PostsModule] })
export class AppModule {}
```

## 5. Boot it

```ts title="src/main.ts"
import { createHttpApplication } from "@blixis-io/http";
import { AppModule } from "./app.module.js";

const app = await createHttpApplication(AppModule);
await app.listen(3000);

console.log("Listening on http://localhost:3000");
```

```bash
pnpm run build && pnpm start
```

## 6. Try every route

```bash
# Create
curl -X POST localhost:3000/posts -H 'content-type: application/json' -d '{"title":"hi"}'
# → 201 { "id": "1", "title": "hi", "body": "", "createdAt": "..." }

# Validation failure
curl -X POST localhost:3000/posts -H 'content-type: application/json' -d '{}'
# → 400 problem+json with Zod issues

# List
curl localhost:3000/posts
# → 200 [ { "id": "1", ... } ]

# Get one
curl localhost:3000/posts/1
# → 200 { "id": "1", ... }

# Not found
curl localhost:3000/posts/999
# → 404 problem+json

# Update
curl -X PATCH localhost:3000/posts/1 -H 'content-type: application/json' -d '{"title":"updated"}'
# → 200 { "id": "1", "title": "updated", ... }

# Wrong method on a known path
curl -X DELETE localhost:3000/posts
# → 405, Allow: GET, POST

# Delete
curl -X DELETE localhost:3000/posts/1
# → 204, empty body
```

Every one of these behaviors — the exact status codes, the `Allow` header, the problem+json shape — is covered in [Error Handling](/framework/concepts/error-handling/) and [Routing & Controllers](/framework/concepts/routing-controllers/).

## Next

- Add auth so `DELETE` requires a valid API key: [Add Authentication](/framework/tutorials/add-authentication/).
- Add a new endpoint test-first instead of curling by hand: [Test-Driven API Development](/framework/tutorials/test-driven-api-development/).
