---
title: "@blixis-io/logging"
description: Full API reference for the logging package.
sidebar:
  order: 5
---

A multi-transport logger — every entry fans out to every configured `Transport` — plus a thin DI integration layer. See [Logging](/framework/concepts/logging/) for the concepts.

## Levels

```ts
const LOG_LEVELS: readonly ["trace", "debug", "info", "warn", "error", "fatal"];
type LogLevel = (typeof LOG_LEVELS)[number];

function levelSeverity(level: LogLevel): number; // index into LOG_LEVELS; higher = more severe
function isLevelEnabled(level: LogLevel, minLevel: LogLevel): boolean;
```

## `createLogger`

```ts
function createLogger(options: CreateLoggerOptions): Logger;

interface CreateLoggerOptions {
  transports: Transport[];
  /** Floor below which nothing reaches any transport, regardless of each transport's own minLevel. Default: `"trace"`. */
  minLevel?: LogLevel;
  /** Bound context merged into every entry; extend per call-site with each method's second argument, or scope it with `child()`. */
  context?: Record<string, unknown>;
}
```

## `Logger`

```ts
interface Logger {
  trace(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  fatal(message: string, context?: Record<string, unknown>): void;
  /** A logger that merges `context` into every entry's context, on top of this logger's own bound context. Does not mutate this logger. */
  child(context: Record<string, unknown>): Logger;
}
```

Attach an `Error` under the `error` context key by convention (`logger.error("save failed", { error: err, postId })`) — every level method keeps the same `(message, context?)` shape rather than a special-cased error parameter.

## `Transport` and `LogRecord`

```ts
interface Transport {
  /** Entries below this level are never passed to log(). Default: "trace" (everything). */
  minLevel?: LogLevel;
  log(record: LogRecord): void | Promise<void>;
}

interface LogRecord {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: string; // ISO 8601
  readonly context: Readonly<Record<string, unknown>>;
}
```

`log()` may be async — a transport shipping to Sentry/Slack/Logstash makes a network call — but `createLogger()` never awaits it. A transport that throws synchronously or returns a rejected promise is caught and reported via `console.error`, never propagated to the caller and never allowed to block or skip the other transports.

## `consoleTransport`

```ts
function consoleTransport(options?: ConsoleTransportOptions): Transport;

interface ConsoleTransportOptions {
  minLevel?: LogLevel;
  /** Write each record as one JSON line instead of a human-readable one — friendlier to log aggregators. Default: false. */
  json?: boolean;
}
```

Routes by level: `trace`→`console.log`, `debug`→`console.debug`, `info`→`console.info`, `warn`→`console.warn`, `error`/`fatal`→`console.error`. Human-readable format is `<timestamp> <LEVEL> <message>`, with non-empty context appended as trailing JSON; `{ json: true }` writes the whole `LogRecord` as one JSON line instead.

The only transport shipped so far — Sentry/Slack/Logstash transports are planned as separate subpath exports (`@blixis-io/logging/sentry`, etc.), each pulling its own SDK as an optional peer dependency, not yet built.

## DI integration

```ts
const LOGGER: InjectionToken<Logger>;

class LoggerModule {
  static forRoot(options: CreateLoggerOptions): DynamicModule;
}
```

```ts
@Module({
  imports: [LoggerModule.forRoot({ transports: [consoleTransport()] })],
})
class AppModule {}

@Injectable()
class PostsService {
  constructor(@Inject(LOGGER) private log: Logger) {}
}
```

`LoggerModule` is the only piece of this package that depends on `@blixis-io/core`/`@blixis-io/di` — `createLogger`, `Logger`, `Transport`, and `consoleTransport` are plain, framework-agnostic TypeScript usable without a `Container` at all.
