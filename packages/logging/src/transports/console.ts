import type { LogLevel } from "../levels.js";
import { safeStringify } from "../serialize.js";
import type { LogRecord, Transport } from "../types.js";

export interface ConsoleTransportOptions {
  minLevel?: LogLevel;
  /** Write each record as one JSON line instead of a human-readable one — friendlier to log aggregators. Default: `false`. */
  json?: boolean;
}

const CONSOLE_METHOD = {
  trace: "log",
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
  fatal: "error",
} as const satisfies Record<LogLevel, "log" | "debug" | "info" | "warn" | "error">;

function formatHuman(record: LogRecord): string {
  const base = `${record.timestamp} ${record.level.toUpperCase()} ${record.message}`;
  return Object.keys(record.context).length > 0 ? `${base} ${safeStringify(record.context)}` : base;
}

/** The default transport: writes to `console`, routed by level (`fatal` also goes to `console.error`, there's no more-severe console method). */
export function consoleTransport(options: ConsoleTransportOptions = {}): Transport {
  return {
    minLevel: options.minLevel,
    log(record) {
      const line = options.json ? safeStringify(record) : formatHuman(record);
      console[CONSOLE_METHOD[record.level]](line);
    },
  };
}
