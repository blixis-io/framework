import { Module, type DynamicModule } from "@blixis/core";
import { InjectionToken } from "@blixis/di";
import { createLogger, type CreateLoggerOptions } from "./logger.js";
import type { Logger } from "./types.js";

export const LOGGER = new InjectionToken<Logger>("blixis.logger");

/** `LoggerModule.forRoot({ transports: [...] })` builds one `Logger` and provides it under `LOGGER` for the whole app to `@Inject`. */
@Module()
export class LoggerModule {
  static forRoot(options: CreateLoggerOptions): DynamicModule {
    return {
      module: LoggerModule,
      providers: [{ provide: LOGGER, useFactory: () => createLogger(options) }],
    };
  }
}
