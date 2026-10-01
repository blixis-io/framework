import { describe, expect, it } from "vitest";
import { literal, renderConfigFile, renderTarget } from "./config-file.js";

describe("literal", () => {
  it.each([
    ["a string", "x", '"x"'],
    ["a number", 3, "3"],
    ["a boolean", true, "true"],
    ["null", null, "null"],
    ["an array", ["a", "b"], '["a", "b"]'],
    ["an empty object", {}, "{}"],
    ["a flat object on one line", { host: "ghcr.io" }, '{ host: "ghcr.io" }'],
    ["a key that isn't an identifier, quoted", { "a-b": 1 }, '{ "a-b": 1 }'],
  ])("%s", (_label, value, expected) => {
    expect(literal(value)).toBe(expected);
  });

  it("nested objects go multi-line and indent", () => {
    expect(literal({ a: { b: 1 } })).toBe("{\n  a: { b: 1 },\n}");
  });
});

describe("renderTarget", () => {
  it("renders properties then comments", () => {
    expect(renderTarget("prod", { type: "docker", registry: { host: "r.io" } }, ["note one"], 0)).toBe(
      'prod: {\n  type: "docker",\n  registry: { host: "r.io" },\n  // note one\n},',
    );
  });
});

describe("renderConfigFile", () => {
  it("is a complete defineConfig module (golden)", () => {
    expect(renderConfigFile("prod", { type: "vercel" }, [])).toBe(`import { defineConfig } from "@blixis-io/cli";

export default defineConfig({
  deploy: {
    targets: {
      prod: {
        type: "vercel",
      },
    },
  },
});
`);
  });
});
