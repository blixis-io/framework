---
title: Logging
description: The multi-transport Logger and how to inject it.
sidebar:
  order: 10
---

`@blixis-io/logging` gives every provider an injectable `Logger`, backed by one or more `Transport`s — destinations the same entry gets sent to, simultaneously.

## Why multiple transports, not one swappable backend

A real app usually wants several things to happen with the same log entry at once: every entry goes to the console (or a log aggregator), but only `error`-and-above also goes to an error tracker like Sentry, and maybe only `fatal` also pages someone via Slack. That's a fan-out, not a single destination you swap out per environment — so a `Logger` is built from a **list** of transports, each with its own independent `minLevel`:

```ts
import { createLogger, consoleTransport } from "@blixis-io/logging";

const logger = createLogger({
  transports: [
    consoleTransport(), // everything
    // sentryTransport({ dsn, minLevel: "error" }),  // planned, not built yet
  ],
});
```

Right now only `consoleTransport` ships — see the [reference](/framework/reference/blixis-logging/#consoletransport) — but the `Transport` interface is the whole extension point: a Sentry/Slack/Logstash transport is just another object implementing `log(record)`.

## Levels

`trace` < `debug` < `info` < `warn` < `error` < `fatal`, same ordering as most logging libraries. `createLogger({ minLevel })` sets a global floor below which nothing reaches *any* transport; each transport can also set its own `minLevel` on top of that, filtering independently (the console gets everything, an error-tracking transport only fires on `error`+).

## Calling it

```ts
logger.info("post created", { postId: post.id });
logger.error("save failed", { error: err, postId: post.id });
```

Every level method has the same `(message, context?)` shape — there's no special-cased error parameter. Attach an `Error` under the conventional `error` context key instead; a transport that cares (Sentry) knows to look for it there.

## Bound context and `child()`

```ts
const logger = createLogger({ transports: [...], context: { service: "hello-api" } });
const requestLogger = logger.child({ requestId: "abc-123" });

requestLogger.info("handling request"); // { service: "hello-api", requestId: "abc-123" }
```

`child()` merges its context on top of the parent's without mutating the parent — the standard pattern for a per-request logger that carries a request ID through everything it logs, while the base `service` context stays shared. Call-site context (the second argument to a level method) wins over bound context on key collision.

## Injecting it

```ts
import { Inject, Injectable } from "@blixis-io/di";
import { LOGGER, LoggerModule, consoleTransport, type Logger } from "@blixis-io/logging";
import { Module } from "@blixis-io/core";

@Injectable()
class PostsService {
  constructor(@Inject(LOGGER) private log: Logger) {}

  create(input: CreatePostInput) {
    this.log.info("creating post", { title: input.title });
    // ...
  }
}

@Module({
  imports: [LoggerModule.forRoot({ transports: [consoleTransport()] })],
  providers: [PostsService],
})
class AppModule {}
```

`LOGGER` is a plain `InjectionToken<Logger>`; `LoggerModule.forRoot(options)` is the standard `DynamicModule`/`forRoot()` pattern (see [Modules](/framework/concepts/modules/#dynamic-modules-the-forroot-pattern)) that provides one `Logger` under that token for the whole app to `@Inject`.

## What's out of scope for now

`@blixis-io/http`'s own internal error handling (the `500` fallback in `createHandler`, the socket-level catch in `HttpApplication.listen()`) still uses raw `console.error` — it isn't wired up to accept an injected `Logger` yet. `@blixis-io/logging` depends on `@blixis-io/core`, so `@blixis-io/http` *can* safely depend on it without a cycle, but that integration hasn't been done. If you want structured logging from the framework's own internals today, you'd need to fork those two `console.error` call sites yourself.

## Next

- Every exported symbol with full signatures: [`@blixis-io/logging` reference](/framework/reference/blixis-logging/).
- See it wired into a real app: the [hello-api walkthrough](/framework/examples/hello-api-walkthrough/).
