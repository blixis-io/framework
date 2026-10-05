import { describe, expect, it } from "vitest";
import { DEFAULT_CLI_VERSIONS } from "./cli-versions.js";

describe("DEFAULT_CLI_VERSIONS", () => {
  it.each(Object.entries(DEFAULT_CLI_VERSIONS))("%s is an exact version, never a tag such as latest or a range", (_cli, version) => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("covers every provider CLI the targets run", () => {
    expect(Object.keys(DEFAULT_CLI_VERSIONS).toSorted()).toEqual(["netlify-cli", "vercel", "wrangler"]);
  });
});
