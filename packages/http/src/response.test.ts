import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ResponseValidationError, validateResponse } from "./response.js";

describe("validateResponse", () => {
  it("returns the value unchanged when there is no schema", async () => {
    await expect(validateResponse(undefined, { anything: true })).resolves.toEqual({ anything: true });
  });

  it("returns the parsed, possibly-transformed value when validation passes", async () => {
    const schema = z.object({ id: z.string(), count: z.coerce.number() });

    await expect(validateResponse(schema, { id: "1", count: "3" })).resolves.toEqual({ id: "1", count: 3 });
  });

  it("throws ResponseValidationError when validation fails", async () => {
    const schema = z.object({ id: z.string() });

    await expect(validateResponse(schema, { id: 1 })).rejects.toThrow(ResponseValidationError);
  });

  it("attaches the Zod issues to the thrown error", async () => {
    const schema = z.object({ id: z.string() });

    const error = await validateResponse(schema, { id: 1 }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ResponseValidationError);
    expect(error).toMatchObject({ issues: expect.arrayContaining([expect.anything()]) });
  });
});

describe("ResponseValidationError", () => {
  it("has a descriptive message and name", () => {
    const schema = z.object({ id: z.string() });
    const result = schema.safeParse({ id: 1 });
    const error = new ResponseValidationError(result.success ? [] : result.error.issues);

    expect(error.name).toBe("ResponseValidationError");
    expect(error.message).toContain("id");
  });

  it("strips keys the schema does not declare (the schema is an output allow-list)", async () => {
    const schema = z.object({ id: z.string() });

    await expect(validateResponse(schema, { id: "1", passwordHash: "secret" })).resolves.toEqual({ id: "1" });
  });

  it("falls back to async parsing for a schema with an async refinement", async () => {
    const schema = z.object({ id: z.string().refine((value) => Promise.resolve(value.length > 0)) });

    await expect(validateResponse(schema, { id: "1" })).resolves.toEqual({ id: "1" });
    await expect(validateResponse(schema, { id: "" })).rejects.toThrow(ResponseValidationError);
  });

  it("rethrows a non-Zod error from a schema instead of swallowing it", async () => {
    const schema = z.string().transform(() => {
      throw new Error("boom");
    });

    await expect(validateResponse(schema, "x")).rejects.toThrow("boom");
  });
});
