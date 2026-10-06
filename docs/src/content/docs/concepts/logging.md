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

`trace` < `debug` < `info` < `warn` < `error` < `fatal`, same ordering as most logging libraries. A call that nothing would receive (below the logger's floor, or below every transport's own floor) returns immediately, **before** its context is merged or copied, so leaving `debug` calls in hot code costs a couple of comparisons when they are off. `createLogger({ minLevel })` sets a global floor below which nothing reaches *any* transport; each transport can also set its own `minLevel` on top of that, filtering independently (the console gets everything, an error-tracking transport only fires on `error`+).

## Calling it

```ts
logger.info("post created", { postId: post.id });
logger.error("save failed", { error: err, postId: post.id });
```

Every level method has the same `(message, context?)` shape — there's no special-cased error parameter. Attach an `Error` under the conventional `error` context key instead; a transport that cares (Sentry) knows to look for it there.

### Errors, cycles and other awkward values

The console transport writes a context as JSON, and plain `JSON.stringify` loses an `Error` (it writes `{}`), throws on a circular object or a `BigInt`, and silently drops functions. The transport uses a safe serializer instead, so the log line is always written and nothing useful is lost:

| In the context | Written as |
| --- | --- |
| an `Error` | `{ name, message, stack, cause, ...its own properties }` (a `code` such as `ECONNREFUSED` stays), recursively for the cause chain; an `AggregateError` lists its `errors` |
| a circular reference | `"[Circular]"` (only for an ancestor; the same object used twice is written twice) |
| a `BigInt` | its digits as text |
| a function or symbol | `"[Function: name]"`, `"Symbol(name)"` |
| a `Map` or `Set` | an array |
| a `Date` or anything with `toJSON()` | what `toJSON()` returns |
| a getter that throws | `"[Unreadable: <message>]"` |
| nesting deeper than 8 levels | `"[Object]"` / `"[Array]"` |

`safeStringify(value)` and `toJsonSafe(value)` are exported, so your own transport (a file, a network service) can do the same.

## Keeping secrets out of the logs

```ts
const logger = createLogger({
  transports: [consoleTransport()],
  redact: ["password", "authorization", "token", "cookie"],
});

logger.info("login", { user: "ada", password: "hunter2", headers: { Authorization: "Bearer abc" } });
// context reaching every transport: { user: "ada", password: "[REDACTED]", headers: { Authorization: "[REDACTED]" } }
```

A key in `redact` has its value replaced with `"[REDACTED]"` wherever it appears in the context, at any depth and whatever its type (a whole object is replaced too). Keys are matched by **whole name, ignoring case**: `password` catches `Password` and `PASSWORD` but not `passwordHint` or `tokens`. It also applies to what a `child()` bound, and reaches inside an attached `Error`'s own properties and cause. `COMMON_SECRET_KEYS` is a ready-made starting list (`password`, `token`, `authorization`, `cookie`, `set-cookie`, `api-key`, ...).

Two things to know. It is **opt-in**: with no `redact` list nothing is hidden, and an `Error` in the context reaches your transports as the real `Error` object. With a list, each entry's context is first written out as plain data, so an `Error` arrives as an object with its name, message and stack instead. And it covers the **context only**: a secret interpolated into the message string (`` `token ${token}` ``) is not found, so keep secrets out of messages.

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

`@blixis-io/http` takes an `onError` option, so unexpected errors in a request (and a failed boot under `createFetchHandler`) can go to your logger with the request, the route and the request id; see [Logging requests and errors](/framework/guides/logging-requests-and-errors/). Still on `console.error`: the shutdown-hook failures `@blixis-io/core` reports while rolling back a failed boot, and `@blixis-io/events` listener failures; neither takes an injected logger yet.

## Next

- Every exported symbol with full signatures: [`@blixis-io/logging` reference](/framework/reference/blixis-logging/).
- See it wired into a real app: the [hello-api walkthrough](/framework/examples/hello-api-walkthrough/).
