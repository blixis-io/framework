import { describe, expect, it } from "vitest";
import { InvalidNameError, parseName, toKebabCase, toPascalCase } from "./names.js";

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

describe("parseName", () => {
  it("returns the kebab and Pascal forms of a valid name", () => {
    expect(parseName("post-tags")).toEqual({ kebab: "post-tags", pascal: "PostTags" });
    expect(parseName("PostTags")).toEqual({ kebab: "post-tags", pascal: "PostTags" });
    expect(parseName("v2-users")).toEqual({ kebab: "v2-users", pascal: "V2Users" });
  });

  it.each(["123", "2fa", "9-lives"])("rejects %s: the class name would start with a digit, which is not valid TypeScript", (name) => {
    expect(() => parseName(name)).toThrow(InvalidNameError);
    expect(() => parseName(name)).toThrow("start with a letter");
  });

  it.each(["", "---", "___", "...", "   "])("rejects %j: nothing is left to name a file or class after", (name) => {
    expect(() => parseName(name)).toThrow(InvalidNameError);
    expect(() => parseName(name)).toThrow("letter");
  });

  it.each(["Ünïcode", "café", "日本語", "naïve-posts"])("rejects %s instead of silently dropping the non-ASCII characters", (name) => {
    expect(() => parseName(name)).toThrow(InvalidNameError);
    expect(() => parseName(name)).toThrow("ASCII");
  });
});
