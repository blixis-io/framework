import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPlugin } from "./plugins.js";
import { installFakePlugin } from "./test-helpers.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "blix-plugin-test-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("loadPlugin", () => {
  it("says not-installed, naming the package, when the project lacks it", async () => {
    await expect(loadPlugin("deploy", cwd)).resolves.toEqual({ kind: "not-installed", packageName: "@blixis-io/deploy" });
  });

  it("loads the plugin from the project's own node_modules", async () => {
    installFakePlugin(cwd, "deploy");

    const lookup = await loadPlugin("deploy", cwd);

    expect(lookup.kind).toBe("loaded");
    expect(lookup.kind === "loaded" && lookup.command.name).toBe("deploy");
  });

  it("finds a plugin installed in a parent directory's node_modules", async () => {
    installFakePlugin(cwd, "deploy");
    const nested = join(cwd, "apps", "api");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(nested, { recursive: true });

    expect((await loadPlugin("deploy", nested)).kind).toBe("loaded");
  });

  it("reports invalid when the package doesn't export a blixCommand", async () => {
    installFakePlugin(cwd, "deploy", "export const somethingElse = 1;\n");

    const lookup = await loadPlugin("deploy", cwd);

    expect(lookup).toMatchObject({ kind: "invalid", packageName: "@blixis-io/deploy" });
    expect(lookup.kind === "invalid" && lookup.reason).toContain("blixCommand");
  });

  it("reports invalid, with the error, when importing the package throws", async () => {
    installFakePlugin(cwd, "deploy", 'throw new Error("bad plugin");\n');

    const lookup = await loadPlugin("deploy", cwd);

    expect(lookup.kind === "invalid" && lookup.reason).toContain("bad plugin");
  });

  it("refuses a command that isn't a known plugin", async () => {
    await expect(loadPlugin("bogus", cwd)).resolves.toMatchObject({ kind: "invalid" });
  });
});
