import type { z } from "zod";

/** Thrown by `ConfigModule.forRoot()` when the source (env by default) fails schema validation — fails at module-definition time, not first use. */
export class ConfigValidationError extends Error {
  constructor(zodError: z.ZodError) {
    const issues = zodError.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    super(`Invalid configuration:\n${issues}`);
    this.name = "ConfigValidationError";
  }
}
