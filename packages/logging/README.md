# `@blixis-io/logging`

A multi-transport logger, injectable like any other provider. Doesn't depend on `@blixis-io/http` — usable in any app, HTTP or not.

```bash
npm install @blixis-io/logging @blixis-io/core @blixis-io/di
```

```ts
import { createLogger, consoleTransport } from "@blixis-io/logging";

const logger = createLogger({
  transports: [consoleTransport()],
});

logger.info("post created", { postId: post.id });
logger.error("save failed", { error: err, postId: post.id });
```

Every log entry fans out to every configured transport at once — each with its own independent `minLevel` — instead of one swappable backend. A real app usually wants console *and* an error tracker *and* maybe a Slack ping, simultaneously.

Part of [Blixis Framework](https://github.com/blixis-io/framework) — full docs: [Logging](https://blixis-io.github.io/framework/concepts/logging/) · [API reference](https://blixis-io.github.io/framework/reference/blixis-logging/).
