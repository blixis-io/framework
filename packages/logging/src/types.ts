import type { LogLevel } from "./levels.js";

export interface LogRecord {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: string;
  /**
   * Structured metadata bound to this entry. An attached `Error` goes under
   * the `error` key by convention — transports that care (Sentry, etc.)
   * look for it there rather than a dedicated parameter, so every level
   * keeps the same `(message, context?)` signature.
   */
  readonly context: Readonly<Record<string, unknown>>;
}

/**
 * A log destination. `log()` may be async (a network call to Sentry/Slack/
 * Logstash); `createLogger()` never awaits it — a slow or failing transport
 * must never block or crash the caller of `logger.info(...)`.
 */
export interface Transport {
  /** Entries below this level are never passed to `log()`. Default: `"trace"` (everything). */
  minLevel?: LogLevel | undefined;
  log(record: LogRecord): void | Promise<void>;
}

export interface Logger {
  trace(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  fatal(message: string, context?: Record<string, unknown>): void;
  /** A logger that merges `context` into every entry's context, on top of this logger's own bound context. */
  child(context: Record<string, unknown>): Logger;
}
