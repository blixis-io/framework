import { describe, expect, it } from "vitest";
import { RequestContext, RequestContextError, runInRequestContext } from "./request-context.js";

async function readUser(ctx: RequestContext): Promise<unknown> {
  await Promise.resolve();
  return ctx.get("user");
}

async function runTagged(id: number): Promise<unknown> {
  return runInRequestContext(async () => {
    const ctx = new RequestContext();
    ctx.set("id", id);
    // Yield so the two runs genuinely interleave instead of running
    // sequentially — this is what actually exercises AsyncLocalStorage
    // isolation rather than just two back-to-back calls.
    await new Promise((resolve) => setTimeout(resolve, id === 1 ? 10 : 0));
    return ctx.get("id");
  });
}

describe("RequestContext", () => {
  it("returns undefined from get() when called outside a request", () => {
    const ctx = new RequestContext();
    expect(ctx.get("user")).toBeUndefined();
  });

  it("returns false from has() when called outside a request", () => {
    const ctx = new RequestContext();
    expect(ctx.has("user")).toBe(false);
  });

  it("throws RequestContextError from set() when called outside a request", () => {
    const ctx = new RequestContext();
    expect(() => ctx.set("user", { id: 1 })).toThrow(RequestContextError);
  });

  it("round-trips a value set and read within the same request scope", () => {
    runInRequestContext(() => {
      const ctx = new RequestContext();
      ctx.set("user", { id: 1 });
      expect(ctx.get("user")).toEqual({ id: 1 });
      expect(ctx.has("user")).toBe(true);
    });
  });

  it("sees the same store from an awaited call within the same request scope", async () => {
    await runInRequestContext(async () => {
      const ctx = new RequestContext();
      ctx.set("user", { id: 42 });
      await expect(readUser(ctx)).resolves.toEqual({ id: 42 });
    });
  });

  it("starts with a fresh, empty store on each runInRequestContext call", () => {
    runInRequestContext(() => {
      const ctx = new RequestContext();
      ctx.set("user", { id: 1 });
    });

    runInRequestContext(() => {
      const ctx = new RequestContext();
      expect(ctx.get("user")).toBeUndefined();
    });
  });

  it("keeps two concurrent request scopes fully isolated from each other", async () => {
    const [a, b] = await Promise.all([runTagged(1), runTagged(2)]);
    expect(a).toBe(1);
    expect(b).toBe(2);
  });
});

describe("RequestContextError", () => {
  it("has a descriptive message and name", () => {
    const error = new RequestContextError();
    expect(error.name).toBe("RequestContextError");
    expect(error.message).toContain("RequestContext.set()");
  });
});
