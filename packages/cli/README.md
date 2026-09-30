# `@blixis-io/cli`

The `blix` binary. `blix generate <type> <name>` scaffolds one controller/service/module/guard/interceptor file from a template. No `@blixis-io/*` runtime dependency.

```bash
npm install -D @blixis-io/cli
```

```bash
blix generate controller posts
# created src/posts/posts.controller.ts
```

```ts
import { Controller, Get } from "@blixis-io/http";

@Controller("posts")
export class PostsController {
  @Get()
  list() {
    return [];
  }
}
```

`<type>` is `controller`, `service`, `module`, `guard`, or `interceptor` (or its first letter). Deliberately dumb: it writes one file and never wires anything else up — no auto-added `controllers` array entry, no auto-import.

Part of [Blixis Framework](https://github.com/blixis-io/framework) — full docs: [Code Generation](https://blixis-io.github.io/framework/concepts/code-generation/) · [API reference](https://blixis-io.github.io/framework/reference/blixis-cli/).
