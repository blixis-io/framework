import { describe, expect, it } from "vitest";
import { Controller, getControllerPrefix } from "./controller.js";

describe("@Controller", () => {
  it("stores a normalized prefix (no leading/trailing slashes)", () => {
    @Controller("/posts/")
    class PostController {}

    expect(getControllerPrefix(PostController)).toBe("posts");
  });

  it("defaults to an empty prefix when called with no arguments", () => {
    @Controller()
    class RootController {}

    expect(getControllerPrefix(RootController)).toBe("");
  });

  it("an undecorated class has no controller prefix recorded", () => {
    class Plain {}

    expect(getControllerPrefix(Plain)).toBeUndefined();
  });
});
