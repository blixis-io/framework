import { describe, expect, it } from "vitest";
import { InjectionToken } from "./tokens.js";

describe("InjectionToken", () => {
  it("carries a human-readable description for error messages", () => {
    const token = new InjectionToken<string>("app.name");

    expect(token.description).toBe("app.name");
    expect(token.toString()).toBe("InjectionToken(app.name)");
  });

  it("is distinct per instance even with the same description", () => {
    const a = new InjectionToken<number>("count");
    const b = new InjectionToken<number>("count");

    expect(a).not.toBe(b);
  });
});
