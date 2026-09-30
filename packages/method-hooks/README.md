# `@blixis-io/method-hooks`

`@Before`/`@After`/`@Around` method decorators for adding behavior without editing a method's body. No dependency on any other `@blixis-io/*` package — works on any class.

```bash
npm install @blixis-io/method-hooks
```

```ts
import { After, Around, Before } from "@blixis-io/method-hooks";

class PostsService {
  @Before((input: CreatePostInput) => {
    console.log("creating post", input.title);
  })
  @Around((next: (input: CreatePostInput) => Post, input: CreatePostInput) => {
    const start = performance.now();
    const result = next(input);
    console.log("took", performance.now() - start, "ms");
    return result;
  })
  create(input: CreatePostInput): Post {
    // ...
  }
}
```

These are method hooks, not a plugin/extension system — nothing here lets one package attach behavior to another package's class without editing its source; you apply these directly on a method in a class you own.

Part of [Blixis Framework](https://github.com/blixis-io/framework) — full docs: [Method Hooks](https://blixis-io.github.io/framework/concepts/method-hooks/) · [API reference](https://blixis-io.github.io/framework/reference/blixis-method-hooks/).
