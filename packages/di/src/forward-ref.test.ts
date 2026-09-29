import { describe, expect, it } from "vitest";
import { forwardRef, isForwardRef, unwrapForwardRef } from "./forward-ref.js";

describe("forwardRef", () => {
  it("wraps a lazy class reference and marks it as a forward ref", () => {
    class Later {}
    const ref = forwardRef(() => Later);

    expect(isForwardRef(ref)).toBe(true);
    expect(ref()).toBe(Later);
  });

  it("does not mark a plain function as a forward ref", () => {
    class Plain {}

    expect(isForwardRef(Plain)).toBe(false);
    expect(isForwardRef(() => Plain)).toBe(false);
  });

  it("unwrapForwardRef resolves refs and passes through plain tokens", () => {
    class Later {}
    const ref = forwardRef(() => Later);

    expect(unwrapForwardRef(ref)).toBe(Later);
    expect(unwrapForwardRef(Later)).toBe(Later);
  });
});
