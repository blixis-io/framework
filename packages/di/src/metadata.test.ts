import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { defineMetadata, getMetadata, getOwnMetadata } from "./metadata.js";

describe("metadata helpers", () => {
  it("round-trips class-level metadata through a typed key", () => {
    class Target {}
    const key = Symbol("test:key");

    defineMetadata(key, { scope: "singleton" }, Target);

    expect(getMetadata<{ scope: string }>(key, Target)).toEqual({ scope: "singleton" });
  });

  it("returns undefined for metadata that was never set", () => {
    class Target {}
    const key = Symbol("test:missing");

    expect(getMetadata(key, Target)).toBeUndefined();
  });

  it("supports property-scoped metadata", () => {
    class Target {
      method(): void {}
    }
    const key = Symbol("test:prop");

    defineMetadata(key, "value", Target.prototype, "method");

    expect(getMetadata(key, Target.prototype, "method")).toBe("value");
  });

  it("getOwnMetadata does not see metadata inherited from a parent class", () => {
    const key = Symbol("test:own");
    class Parent {}
    defineMetadata(key, "parent-value", Parent);
    class Child extends Parent {}

    expect(getMetadata(key, Child)).toBe("parent-value");
    expect(getOwnMetadata(key, Child)).toBeUndefined();
  });

  it("getOwnMetadata supports property-scoped lookups too", () => {
    class Target {
      method(): void {}
    }
    const key = Symbol("test:own-prop");

    defineMetadata(key, "value", Target.prototype, "method");

    expect(getOwnMetadata(key, Target.prototype, "method")).toBe("value");
  });
});
