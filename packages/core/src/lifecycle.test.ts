import { describe, expect, it } from "vitest";
import { hasOnApplicationShutdown, hasOnModuleInit } from "./lifecycle.js";

describe("hasOnModuleInit", () => {
  it("is true for an instance with an onModuleInit method", () => {
    class WithHook {
      onModuleInit(): void {}
    }

    expect(hasOnModuleInit(new WithHook())).toBe(true);
  });

  it("is false for an instance without the hook, and for non-objects", () => {
    class WithoutHook {}

    expect(hasOnModuleInit(new WithoutHook())).toBe(false);
    expect(hasOnModuleInit(null)).toBe(false);
    expect(hasOnModuleInit(42)).toBe(false);
  });
});

describe("hasOnApplicationShutdown", () => {
  it("is true for an instance with an onApplicationShutdown method", () => {
    class WithHook {
      onApplicationShutdown(): void {}
    }

    expect(hasOnApplicationShutdown(new WithHook())).toBe(true);
  });

  it("is false for an instance without the hook", () => {
    class WithoutHook {}

    expect(hasOnApplicationShutdown(new WithoutHook())).toBe(false);
  });
});
