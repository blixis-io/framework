import { describe, expect, it } from "vitest";
import { DbConnectionError } from "./errors.js";

describe("DbConnectionError", () => {
  it("wraps an Error cause, using its message", () => {
    const error = new DbConnectionError(new Error("connection refused"));

    expect(error.message).toBe("Failed to connect to database: connection refused");
    expect(error.name).toBe("DbConnectionError");
    expect(error.cause).toBeInstanceOf(Error);
  });

  it("stringifies a non-Error cause", () => {
    const error = new DbConnectionError("timeout");

    expect(error.message).toBe("Failed to connect to database: timeout");
    expect(error.cause).toBe("timeout");
  });
});
