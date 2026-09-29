import type { ZodType } from "zod";

interface ResponseValidationIssue {
  path: PropertyKey[];
  message: string;
}

/**
 * Thrown when a handler's return value doesn't match its `@Returns`
 * schema. Deliberately not an `HttpException` — this is a server-side
 * contract bug, not the client's fault, so it falls through to the
 * generic 500 path instead of exposing the mismatch (and the app's
 * internal shape) to the client.
 */
export class ResponseValidationError extends Error {
  constructor(public readonly issues: readonly ResponseValidationIssue[]) {
    super(`Response failed its declared schema: ${issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    this.name = "ResponseValidationError";
  }
}

/** Validates a handler's return value against its `@Returns` schema, if any — returns the value (possibly parsed/coerced) unchanged when there's no schema. */
export async function validateResponse(schema: ZodType | undefined, value: unknown): Promise<unknown> {
  if (!schema) {
    return value;
  }
  const result = await schema.safeParseAsync(value);
  if (!result.success) {
    throw new ResponseValidationError(result.error.issues);
  }
  return result.data;
}
