import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, defineConfig, loadConfig } from "./config.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "blix-config-test-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("defineConfig", () => {
  it("returns its argument unchanged", () => {
    const config = { deploy: { target: "docker" } };
    expect(defineConfig(config)).toBe(config);
  });
});

describe("loadConfig", () => {
  it("returns undefined when there is no config file", async () => {
    await expect(loadConfig(cwd)).resolves.toBeUndefined();
  });

  it("loads a TypeScript config natively, types and all", async () => {
    writeFileSync(
      join(cwd, "blix.config.ts"),
      'interface Target { type: string }\nconst target: Target = { type: "docker" };\nexport default { deploy: { target } };\n',
    );

    const loaded = await loadConfig(cwd);

    expect(loaded?.config).toEqual({ deploy: { target: { type: "docker" } } });
    expect(loaded?.path).toBe(join(cwd, "blix.config.ts"));
  });

  it.each(["blix.config.mjs", "blix.config.js"])("loads %s", async (file) => {
    mkdirSync(cwd, { recursive: true });
    if (file.endsWith(".js")) {
      writeFileSync(join(cwd, "package.json"), '{"type":"module"}');
    }
    writeFileSync(join(cwd, file), "export default { a: 1 };\n");

    expect((await loadConfig(cwd))?.config).toEqual({ a: 1 });
  });

  it("loads a JSON config", async () => {
    writeFileSync(join(cwd, "blix.config.json"), '{"deploy":{"target":"vercel"}}');

    expect((await loadConfig(cwd))?.config).toEqual({ deploy: { target: "vercel" } });
  });

  it("prefers .ts over the other formats", async () => {
    writeFileSync(join(cwd, "blix.config.ts"), "export default { from: 'ts' };\n");
    writeFileSync(join(cwd, "blix.config.json"), '{"from":"json"}');

    expect((await loadConfig(cwd))?.config).toEqual({ from: "ts" });
  });

  it("throws ConfigError naming the file when the config can't be parsed", async () => {
    writeFileSync(join(cwd, "blix.config.json"), "{nope");

    await expect(loadConfig(cwd)).rejects.toThrow(ConfigError);
    await expect(loadConfig(cwd)).rejects.toThrow("Could not load blix.config.json");
  });

  it("throws ConfigError when a module throws while loading", async () => {
    writeFileSync(join(cwd, "blix.config.mjs"), 'throw new Error("boom");\n');

    await expect(loadConfig(cwd)).rejects.toThrow("Could not load blix.config.mjs: boom");
  });

  it.each([["an array", "[1]"], ["a string", '"x"'], ["null", "null"]])("rejects a config that is %s", async (_label, literal) => {
    writeFileSync(join(cwd, "blix.config.mjs"), `export default ${literal};\n`);

    await expect(loadConfig(cwd)).rejects.toThrow("must default-export an object");
  });

  it("rejects a module with no default export", async () => {
    writeFileSync(join(cwd, "blix.config.mjs"), "export const a = 1;\n");

    await expect(loadConfig(cwd)).rejects.toThrow("must default-export an object");
  });
});
