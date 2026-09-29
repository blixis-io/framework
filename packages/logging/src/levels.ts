export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export function levelSeverity(level: LogLevel): number {
  return LOG_LEVELS.indexOf(level);
}

export function isLevelEnabled(level: LogLevel, minLevel: LogLevel): boolean {
  return levelSeverity(level) >= levelSeverity(minLevel);
}
