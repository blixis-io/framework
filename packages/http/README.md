# `@blixis-io/http`

The HTTP layer built on [`@blixis-io/core`](https://www.npmjs.com/package/@blixis-io/core) — routing, controllers, request validation with [Zod](https://zod.dev), guards, RFC 9457 error responses.

```bash
npm install @blixis-io/http @blixis-io/core @blixis-io/di
```

```ts
import { Body, Controller, Get, Param, Post, createHttpApplication } from "@blixis-io/http";
import { Module } from "@blixis-io/core";

@Controller("posts")
class PostController {
  constructor(private readonly posts: PostService) {}

  @Get(":id")
  get(@Param("id") id: string) {
    return this.posts.get(id);
  }

  @Post()
  create(@Body(CreatePostSchema) input: CreatePostInput) {
    return this.posts.create(input);
  }
}

@Module({ providers: [PostService], controllers: [PostController] })
class AppModule {}

const app = await createHttpApplication(AppModule);
await app.listen(3000);
```

Built on the Web-standard `Request`/`Response` — the whole request pipeline is one `(Request) => Promise<Response>` function, testable in-process with no socket needed.

Part of [Blixis Framework](https://github.com/blixis-io/framework) — full docs: [Routing & Controllers](https://blixis-io.github.io/framework/concepts/routing-controllers/) · [API reference](https://blixis-io.github.io/framework/reference/blixis-http/).
