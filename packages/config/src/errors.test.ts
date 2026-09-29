import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConfigValidationError } from "./errors.js";

describe("ConfigValidationError", () => {
  it("lists every failing field, one per line", () => {
    const schema = z.object({
      PORT: z.coerce.number(),
      DATABASE_URL: z.string(),
    });
    const result = schema.safeParse({});
    if (result.success) {
      throw new Error("expected validation to fail");
    }

    const error = new ConfigValidationError(result.error);

    expect(error.message).toContain("Invalid configuration:");
    expect(error.message).toContain("PORT:");
    expect(error.message).toContain("DATABASE_URL:");
    expect(error.name).toBe("ConfigValidationError");
  });
});
