import { Module, type DynamicModule } from "@blixis/core";
import { InjectionToken } from "@blixis/di";
import type { z, ZodType } from "zod";
import { ConfigValidationError } from "./errors.js";

/**
 * Builds a config token + module bound to one Zod schema. Config shape is
 * inherently app-specific — unlike `@blixis/logging`'s `LOGGER`, there's no
 * single fixed type to export a token for, so each app calls this once with
 * its own schema and gets back its own distinct, strongly-typed token.
 */
export function defineConfigModule<Schema extends ZodType>(schema: Schema) {
  const CONFIG = new InjectionToken<z.infer<Schema>>("blixis.config");

  @Module()
  class ConfigModule {
    /** Validates `source` (default: `process.env`) against the schema immediately, providing the parsed result under `CONFIG`. Throws `ConfigValidationError` right away on failure — not deferred to first injection. */
    static forRoot(source: Record<string, string | undefined> = process.env): DynamicModule {
      const result = schema.safeParse(source);
      if (!result.success) {
        throw new ConfigValidationError(result.error);
      }
      return {
        module: ConfigModule,
        providers: [{ provide: CONFIG, useValue: result.data }],
      };
    }
  }

  return { CONFIG, ConfigModule };
}
