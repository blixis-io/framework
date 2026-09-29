---
title: Validating Request Bodies with Zod
description: Define a schema once, use it for both validation and the TypeScript type.
sidebar:
  order: 2
---

See [Request Validation](/concepts/request-validation/) for the full behavior; this is the pattern to actually reach for.

## 1. Define the schema and its type together

```ts title="src/posts/post.schema.ts"
import { z } from "zod";

export const CreatePostSchema = z.object({
  title: z.string().min(1),
  body: z.string().default(""),
});
export type CreatePostInput = z.infer<typeof CreatePostSchema>;

export const UpdatePostSchema = CreatePostSchema.partial();
export type UpdatePostInput = z.infer<typeof UpdatePostSchema>;
```

`.partial()` makes every field optional — the natural shape for a `PATCH` endpoint that only needs to accept the fields the caller wants to change.

## 2. Use it in the controller

```ts title="src/posts/posts.controller.ts"
import { Body, Controller, Patch, Post } from "@blixis/http";
import { CreatePostSchema, UpdatePostSchema, type CreatePostInput, type UpdatePostInput } from "./post.schema.js";

@Controller("posts")
export class PostController {
  @Post()
  create(@Body(CreatePostSchema) input: CreatePostInput) {
    return this.posts.create(input);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body(UpdatePostSchema) input: UpdatePostInput) {
    return this.posts.update(id, input);
  }
}
```

`input` in `create` is guaranteed `{ title: string; body: string }` — not `{ title?: string; body?: string }` — both at the type level and at runtime; a request missing `title` never reaches the handler.

## 3. Handle a `.partial()` update correctly

A partial schema's TypeScript type makes every field `string | undefined`, which is easy to misuse with a naive object spread:

```ts
// Don't: if Zod's output ever included an explicit `undefined` for a
// present-but-empty field, this would silently overwrite real data with undefined.
const updated = { ...existing, ...input };
```

```ts
// Do: resolve each optional field explicitly, falling back to the existing value.
const updated = {
  ...existing,
  title: input.title ?? existing.title,
  body: input.body ?? existing.body,
};
```

This is the exact pattern the framework's own `examples/hello-api` uses for `PostsService.update()`.

## 4. Query params and route params work the same way

```ts
@Get()
list(@Query(z.object({ limit: z.coerce.number().default(20) })) query: { limit: number }) { /* ... */ }

@Get(":id")
get(@Param("id", z.uuid()) id: string) { /* ... */ }
```

`z.coerce.number()` matters here — a route param or query value always arrives as a raw string (it came out of a URL), so a plain `z.number()` would reject every request. Coerce, don't just type-annotate.

## What a validation failure looks like

A `400` with the Zod issues attached — see [Error Handling](/concepts/error-handling/#what-happens-automatically) for the exact response shape.
