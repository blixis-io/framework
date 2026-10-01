import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectPackageManager, runCreate } from "./index.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "create-blixis-test-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const noInstall = () => Promise.resolve(0);

describe("detectPackageManager", () => {
  it.each([
    ["pnpm/11.0.0 npm/? node/v24.0.0 darwin arm64", "pnpm"],
    ["yarn/4.1.0 npm/? node/v24.0.0", "yarn"],
    ["bun/1.2.0 npm/? node/v24.0.0", "bun"],
    ["npm/11.0.0 node/v24.0.0", "npm"],
    [undefined, "npm"],
  ] as const)("%s -> %s", (agent, expected) => {
    expect(detectPackageManager(agent)).toBe(expected);
  });
});

describe("runCreate", () => {
  it("prints usage for --help", async () => {
    const result = await runCreate(["--help"], { cwd });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("create-blixis <directory>");
  });

  it("errors with usage when no directory is given", async () => {
    const result = await runCreate([], { cwd });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage:");
  });

  it("errors on an unknown option", async () => {
    const result = await runCreate(["my-app", "--bogus"], { cwd });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown option "--bogus"');
  });

  it("rejects an invalid package name", async () => {
    const result = await runCreate(["My App"], { cwd });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not a valid package name");
  });

  it("refuses a non-empty directory and leaves it untouched", async () => {
    mkdirSync(join(cwd, "my-app"));
    writeFileSync(join(cwd, "my-app", "keep.txt"), "mine");

    const result = await runCreate(["my-app"], { cwd, install: noInstall });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("already exists and is not empty");
    expect(readFileSync(join(cwd, "my-app", "keep.txt"), "utf8")).toBe("mine");
  });

  it("accepts an existing empty directory", async () => {
    mkdirSync(join(cwd, "my-app"));

    const result = await runCreate(["my-app"], { cwd, install: noInstall });

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(cwd, "my-app", "src", "main.ts"))).toBe(true);
  });

  it("writes the starter app and installs deps with the detected package manager", async () => {
    const calls: { command: string; args: readonly string[]; cwd: string }[] = [];

    const result = await runCreate(["my-app"], {
      cwd,
      userAgent: "pnpm/11.0.0 node/v24.0.0",
      install: (command, args, where) => {
        calls.push({ command, args, cwd: where });
        return Promise.resolve(0);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(cwd, "my-app", "package.json"), "utf8"))).toMatchObject({
      name: "my-app",
      private: true,
      type: "module",
      scripts: { dev: expect.stringContaining("--watch") },
    });
    expect(readFileSync(join(cwd, "my-app", "tsconfig.json"), "utf8")).toContain('"emitDecoratorMetadata": true');
    expect(calls).toEqual([
      { command: "pnpm", args: ["add", "@blixis-io/core", "@blixis-io/di", "@blixis-io/http"], cwd: join(cwd, "my-app") },
      { command: "pnpm", args: ["add", "-D", "typescript", "@types/node", "concurrently"], cwd: join(cwd, "my-app") },
    ]);
    expect(result.stdout).toContain("pnpm dev");
  });

  it("uses `npm install` and `npm run` for npm", async () => {
    const calls: (readonly string[])[] = [];

    const result = await runCreate(["my-app"], {
      cwd,
      userAgent: "npm/11.0.0 node/v24.0.0",
      install: (_command, args) => {
        calls.push(args);
        return Promise.resolve(0);
      },
    });

    expect(calls[0]).toEqual(["install", "@blixis-io/core", "@blixis-io/di", "@blixis-io/http"]);
    expect(calls[1]).toEqual(["install", "-D", "typescript", "@types/node", "concurrently"]);
    expect(result.stdout).toContain("npm run dev");
  });

  it("skips installing and prints the commands with --no-install", async () => {
    const calls: unknown[] = [];

    const result = await runCreate(["my-app", "--no-install"], {
      cwd,
      userAgent: "pnpm/11.0.0",
      install: (...args) => {
        calls.push(args);
        return Promise.resolve(0);
      },
    });

    expect(calls).toEqual([]);
    expect(result.stdout).toContain("pnpm add @blixis-io/core @blixis-io/di @blixis-io/http");
    expect(result.stdout).toContain("pnpm add -D typescript @types/node concurrently");
  });

  it("keeps the files and reports a failed install", async () => {
    const result = await runCreate(["my-app"], { cwd, userAgent: "pnpm/11.0.0", install: () => Promise.resolve(7) });

    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain("failed (exit 7)");
    expect(existsSync(join(cwd, "my-app", "package.json"))).toBe(true);
  });

  it("supports a nested target and names the package after its last segment", async () => {
    const result = await runCreate(["apps/api", "--no-install"], { cwd });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(cwd, "apps", "api", "package.json"), "utf8"))).toMatchObject({ name: "api" });
  });
});

describe("the real built binary", () => {
  const distEntry = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

  it.skipIf(!existsSync(distEntry))("scaffolds a project when executed", () => {
    const out = execFileSync("node", [distEntry, "my-app", "--no-install"], { cwd, encoding: "utf8" });

    expect(out).toContain("Created my-app");
    expect(existsSync(join(cwd, "my-app", "src", "app.module.ts"))).toBe(true);
  });
});
