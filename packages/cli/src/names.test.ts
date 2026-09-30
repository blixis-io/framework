import { describe, expect, it } from "vitest";
import { toKebabCase, toPascalCase } from "./names.js";

describe("toKebabCase", () => {
  it.each([
    ["posts", "posts"],
    ["post-tags", "post-tags"],
    ["PostTags", "post-tags"],
    ["post_tags", "post-tags"],
    ["postTags", "post-tags"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(toKebabCase(input)).toBe(expected);
  });
});

describe("toPascalCase", () => {
  it.each([
    ["posts", "Posts"],
    ["post-tags", "PostTags"],
    ["PostTags", "PostTags"],
    ["post_tags", "PostTags"],
    ["postTags", "PostTags"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(toPascalCase(input)).toBe(expected);
  });
});
