import { isLevelEnabled, type LogLevel } from "./levels.js";
import { redactRecord } from "./serialize.js";
import type { Logger, LogRecord, Transport } from "./types.js";

export interface CreateLoggerOptions {
  transports: Transport[];
  /** Floor below which nothing reaches any transport, regardless of each transport's own minLevel. Default: `"trace"`. */
  minLevel?: LogLevel;
  /** Bound context merged into every entry; extend per call-site with the second argument, or scope it with `child()`. */
  context?: Record<string, unknown>;
  /**
   * Context keys whose values never reach a transport: they are replaced with `"[REDACTED]"` at any depth, whatever
   * their type, compared by whole name and ignoring case (`COMMON_SECRET_KEYS` is a starting list). With this set,
   * each entry's context is written out as plain data first, so an attached `Error` arrives as an object with its
   * name, message and stack rather than as an `Error` instance. Only context is covered: the message string is not.
   */
  redact?: readonly string[];
}

const DEFAULT_MIN_LEVEL: LogLevel = "trace";

function reportTransportFailure(error: unknown): void {
  // The one place this package uses console directly: a transport failing
  // must never crash or silently swallow the caller's own logging.
  console.error("[@blixis-io/logging] a transport failed:", error);
}

/** Whether anything would receive an entry at `level`: the logger's floor, and at least one transport whose own floor allows it. */
function isDeliverable(transports: readonly Transport[], globalMinLevel: LogLevel, level: LogLevel): boolean {
  return isLevelEnabled(level, globalMinLevel) && transports.some((transport) => isLevelEnabled(level, transport.minLevel ?? DEFAULT_MIN_LEVEL));
}

function emit(
  transports: readonly Transport[],
  globalMinLevel: LogLevel,
  level: LogLevel,
  message: string,
  context: Record<string, unknown>,
  redact: readonly string[] | undefined,
): void {
  const safeContext = redact === undefined || redact.length === 0 ? context : redactRecord(context, redact);
  const record: LogRecord = { level, message, timestamp: new Date().toISOString(), context: safeContext };

  for (const transport of transports) {
    if (!isLevelEnabled(level, transport.minLevel ?? DEFAULT_MIN_LEVEL)) {
      continue;
    }
    try {
      const result = transport.log(record);
      if (result instanceof Promise) {
        result.catch(reportTransportFailure);
      }
    } catch (error) {
      reportTransportFailure(error);
    }
  }
}

function buildLogger(transports: readonly Transport[], globalMinLevel: LogLevel, boundContext: Record<string, unknown>, redact: readonly string[] | undefined): Logger {
  const log =
    (level: LogLevel) =>
    (message: string, context: Record<string, unknown> = {}): void => {
      // Checked before the contexts are merged: a disabled `debug` call must not pay for copying them.
      if (!isDeliverable(transports, globalMinLevel, level)) {
        return;
      }
      emit(transports, globalMinLevel, level, message, { ...boundContext, ...context }, redact);
    };

  return {
    trace: log("trace"),
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    fatal: log("fatal"),
    child: (context) => buildLogger(transports, globalMinLevel, { ...boundContext, ...context }, redact),
  };
}

/** Builds a `Logger` that fans every entry out to each transport (filtered by that transport's own `minLevel`), never awaiting or letting a transport failure propagate. */
export function createLogger(options: CreateLoggerOptions): Logger {
  return buildLogger(options.transports, options.minLevel ?? DEFAULT_MIN_LEVEL, options.context ?? {}, options.redact);
}
