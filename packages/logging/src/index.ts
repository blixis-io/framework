export { isLevelEnabled, levelSeverity, LOG_LEVELS, type LogLevel } from "./levels.js";
export { createLogger, type CreateLoggerOptions } from "./logger.js";
export { LOGGER, LoggerModule } from "./module.js";
export { consoleTransport, type ConsoleTransportOptions } from "./transports/console.js";
export type { Logger, LogRecord, Transport } from "./types.js";
