import { isLevelEnabled, type LogLevel } from "./levels.js";
import type { Logger, LogRecord, Transport } from "./types.js";

export interface CreateLoggerOptions {
  transports: Transport[];
  /** Floor below which nothing reaches any transport, regardless of each transport's own minLevel. Default: `"trace"`. */
  minLevel?: LogLevel;
  /** Bound context merged into every entry; extend per call-site with the second argument, or scope it with `child()`. */
  context?: Record<string, unknown>;
}

const DEFAULT_MIN_LEVEL: LogLevel = "trace";

function reportTransportFailure(error: unknown): void {
  // The one place this package uses console directly: a transport failing
  // must never crash or silently swallow the caller's own logging.
  console.error("[@blixis-io/logging] a transport failed:", error);
}

function emit(
  transports: readonly Transport[],
  globalMinLevel: LogLevel,
  level: LogLevel,
  message: string,
  context: Record<string, unknown>,
): void {
  if (!isLevelEnabled(level, globalMinLevel)) {
    return;
  }

  const record: LogRecord = { level, message, timestamp: new Date().toISOString(), context };

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

function buildLogger(transports: readonly Transport[], globalMinLevel: LogLevel, boundContext: Record<string, unknown>): Logger {
  const log =
    (level: LogLevel) =>
    (message: string, context: Record<string, unknown> = {}): void => {
      emit(transports, globalMinLevel, level, message, { ...boundContext, ...context });
    };

  return {
    trace: log("trace"),
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    fatal: log("fatal"),
    child: (context) => buildLogger(transports, globalMinLevel, { ...boundContext, ...context }),
  };
}

/** Builds a `Logger` that fans every entry out to each transport (filtered by that transport's own `minLevel`), never awaiting or letting a transport failure propagate. */
export function createLogger(options: CreateLoggerOptions): Logger {
  return buildLogger(options.transports, options.minLevel ?? DEFAULT_MIN_LEVEL, options.context ?? {});
}
