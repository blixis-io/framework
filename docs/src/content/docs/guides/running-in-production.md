---
title: Running in Production
description: listen(), close(), and graceful shutdown on SIGTERM.
sidebar:
  order: 8
---

## The entry point

```ts title="src/main.ts"
import { createHttpApplication } from "@blixis-io/http";
import { AppModule } from "./app.module.js";

const port = Number(process.env["PORT"] ?? 3000);

const app = await createHttpApplication(AppModule);
await app.listen(port);

console.log(`Listening on http://localhost:${port}`);
```

`listen(port, hostname?)` binds a real `node:http` server and resolves once it's actually accepting connections, with `{ port }` reflecting the bound port (useful when you pass `0` to let the OS pick one, e.g. in tests). `hostname` defaults to `"0.0.0.0"` — all interfaces; pass `"127.0.0.1"` to bind localhost only.

Under the hood, every incoming `IncomingMessage` is converted to a Web-standard `Request` (including a real `AbortSignal` wired to the client connection — see below) and every returned `Response` is streamed back onto the socket. None of this is something you write; it's what `listen()` sets up.

## Graceful shutdown

```ts
process.on("SIGTERM", () => {
  void app.close("SIGTERM").then(() => process.exit(0));
});
```

`app.close(signal?)` closes the listening socket *and* runs every `OnApplicationShutdown` hook in the application (see [Lifecycle Hooks](/framework/concepts/lifecycle-hooks/)) — the string you pass through is handed to each hook as-is, so a database connection's shutdown hook can log or branch on which signal triggered it. `close()` is idempotent: calling it more than once (a signal handler *and* a test's cleanup both running it, say) is safe — the second call is a no-op, not a duplicate teardown.

## Client disconnects propagate as a real `AbortSignal`

`close()` stops accepting new connections, drops idle keep-alive sockets, and lets in-flight requests finish. Anything still running after `shutdownTimeout` (default 10 seconds) has its socket destroyed, which aborts its `request.signal`. Pass `shutdownTimeout: Infinity` to wait indefinitely, or a smaller value to fit your orchestrator's kill grace period.

```ts
const app = await createHttpApplication(AppModule, { shutdownTimeout: 5_000 });
```

If a client closes the connection before a handler finishes, the `Request`'s `signal` fires `"abort"` — useful for cancelling expensive work early:

```ts
@Get("report")
async generateReport(@Req() req: Request) {
  const result = await computeReport({ signal: req.signal });
  return result;
}
```

## In-process, without a socket at all

`app.handle(request)` runs the exact same request-handling logic — routing, validation, guards, error mapping — against an in-memory `Request`, with no server, no port, no network stack. This is what `@blixis-io/testing` is built on (see [Testing](/framework/concepts/testing/)), and it's also a reasonable way to invoke the same application logic from a non-HTTP entry point (a CLI command, a queue worker) without spinning up a socket you don't need.

## What isn't handled for you yet

There's no built-in request logging, rate limiting, CORS, or compression middleware — the framework's HTTP layer is deliberately just routing + validation + guards + error mapping (see [Introduction](/framework/start-here/introduction/)). For now, that means wrapping `app.handle` yourself (a function that calls `app.handle(request)` and does something before/after) or reaching for `node:http`-level middleware ahead of the `createServer` callback if you need it. A first-class middleware/interceptor layer is on the framework's roadmap but doesn't exist yet.
