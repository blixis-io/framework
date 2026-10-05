# `@blixis-io/testing`

A thin testing layer on top of `@blixis-io/http`. Build a real application in a test, override providers with fakes, hit it with real requests.

```bash
npm install -D @blixis-io/testing @blixis-io/http @blixis-io/core @blixis-io/di zod
```

```ts
import { Test } from "@blixis-io/testing";

const app = await Test.createModule({ imports: [PostsModule] })
  .override(PostRepository, { useValue: fakeRepo })
  .compile();

const res = await app.request("/posts");
expect(res.status).toBe(200);

await app.close();
```

`compile()` builds a full `HttpApplication`, exactly the way `createHttpApplication` would in production — nothing about request handling, validation, or guards is mocked. `.override()` swaps in a fake for one provider before the module graph resolves.

Part of [Blixis Framework](https://github.com/blixis-io/framework) — full docs: [Testing](https://blixis-io.github.io/framework/concepts/testing/) · [API reference](https://blixis-io.github.io/framework/reference/blixis-testing/).
