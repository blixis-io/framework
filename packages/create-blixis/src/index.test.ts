import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectPackageManager, packageManagerPin, runCreate } from "./index.js";

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

describe("packageManagerPin", () => {
  it.each([
    ["pnpm/11.25.0 npm/? node/v24.0.0 darwin arm64", "pnpm@11.25.0"],
    ["npm/11.0.0 node/v24.0.0", "npm@11.0.0"],
    ["yarn/4.1.0 npm/? node/v24.0.0", "yarn@4.1.0"],
    ["bun/1.2.0 npm/? node/v24.0.0", undefined],
    ["pnpm/next npm/? node/v24.0.0", undefined],
    [undefined, undefined],
  ] as const)("%s -> %s", (agent, expected) => {
    expect(packageManagerPin(agent)).toBe(expected);
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
      scripts: { dev: "node scripts/dev.mjs" },
    });
    expect(readFileSync(join(cwd, "my-app", "tsconfig.json"), "utf8")).toContain('"emitDecoratorMetadata": true');
    expect(calls).toEqual([
      { command: "pnpm", args: ["add", "@blixis-io/core", "@blixis-io/di", "@blixis-io/http", "zod"], cwd: join(cwd, "my-app") },
      { command: "pnpm", args: ["add", "-D", "typescript", "@types/node"], cwd: join(cwd, "my-app") },
    ]);
    expect(result.stdout).toContain("pnpm dev");
  });

  it("pins the package manager that ran create in package.json, and leaves it out when unknown", async () => {
    await runCreate(["pinned", "--no-install"], { cwd, userAgent: "pnpm/11.25.0 npm/? node/v24.0.0" });
    await runCreate(["unpinned", "--no-install"], { cwd });

    expect(JSON.parse(readFileSync(join(cwd, "pinned", "package.json"), "utf8"))).toMatchObject({ packageManager: "pnpm@11.25.0" });
    expect(JSON.parse(readFileSync(join(cwd, "unpinned", "package.json"), "utf8"))).not.toHaveProperty("packageManager");
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

    expect(calls[0]).toEqual(["install", "@blixis-io/core", "@blixis-io/di", "@blixis-io/http", "zod"]);
    expect(calls[1]).toEqual(["install", "-D", "typescript", "@types/node"]);
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
    expect(result.stdout).toContain("pnpm add @blixis-io/core @blixis-io/di @blixis-io/http zod");
    expect(result.stdout).toContain("pnpm add -D typescript @types/node");
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

describe("runCreate --deploy", () => {
  type Call = { command: string; args: readonly string[]; cwd: string };
  const recorder = (code = 0, failOn?: string) => {
    const calls: Call[] = [];
    return {
      calls,
      install: (command: string, args: readonly string[], where: string) => {
        calls.push({ command, args, cwd: where });
        return Promise.resolve(failOn !== undefined && `${command} ${args.join(" ")}`.includes(failOn) ? code : 0);
      },
    };
  };

  it("installs the CLI and deploy plugin, then runs blix deploy init in the new project", async () => {
    const { calls, install } = recorder();

    const result = await runCreate(["my-app", "--deploy", "docker", "--ci", "github"], { cwd, userAgent: "pnpm/11.25.0 node/v24", install });

    expect(result.exitCode).toBe(0);
    expect(calls.map((call) => `${call.command} ${call.args.join(" ")}`)).toEqual([
      "pnpm add @blixis-io/core @blixis-io/di @blixis-io/http zod",
      "pnpm add -D typescript @types/node",
      "pnpm add -D @blixis-io/cli @blixis-io/deploy",
      "pnpm exec blix deploy init --target docker --ci github",
    ]);
    expect(calls.every((call) => call.cwd === join(cwd, "my-app"))).toBe(true);
    expect(result.stdout).toContain("Deploy (docker, github):");
    expect(result.stdout).toContain("pnpm exec blix deploy --dry-run");
  });

  it("accepts --deploy=target, and --ci is optional", async () => {
    const { calls, install } = recorder();

    await runCreate(["my-app", "--deploy=vercel"], { cwd, userAgent: "pnpm/11.25.0", install });

    expect(calls.at(-1)?.args).toEqual(["exec", "blix", "deploy", "init", "--target", "vercel"]);
  });

  it.each([
    ["npm/11.0.0", "npx", ["blix", "deploy", "init", "--target", "netlify"]],
    ["yarn/4.1.0", "yarn", ["blix", "deploy", "init", "--target", "netlify"]],
    ["bun/1.2.0", "bunx", ["blix", "deploy", "init", "--target", "netlify"]],
  ] as const)("%s runs the local blix through its own runner", async (agent, command, args) => {
    const { calls, install } = recorder();

    await runCreate(["my-app", "--deploy", "netlify"], { cwd, userAgent: agent, install });

    expect(calls.at(-1)).toMatchObject({ command, args });
  });

  it("does not touch deployment without --deploy", async () => {
    const { calls, install } = recorder();

    const result = await runCreate(["my-app"], { cwd, userAgent: "pnpm/11.25.0", install });

    expect(calls).toHaveLength(2);
    expect(result.stdout).not.toContain("Deploy (");
  });

  it("rejects --ci without --deploy before writing anything", async () => {
    const result = await runCreate(["my-app", "--ci", "github"], { cwd });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--ci only makes sense with --deploy");
    expect(existsSync(join(cwd, "my-app"))).toBe(false);
  });

  it.each([["--deploy"], ["--deploy", "--no-install"], ["--ci"]])("rejects %j with no value", async (...args) => {
    const result = await runCreate(["my-app", ...args], { cwd });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/--(deploy|ci) needs a value/);
  });

  it("with --no-install prints every command to run instead of running any", async () => {
    const { calls, install } = recorder();

    const result = await runCreate(["my-app", "--deploy", "cloudflare", "--no-install"], { cwd, userAgent: "pnpm/11.25.0", install });

    expect(calls).toEqual([]);
    expect(result.stdout).toContain("pnpm add -D @blixis-io/cli @blixis-io/deploy");
    expect(result.stdout).toContain("pnpm exec blix deploy init --target cloudflare");
  });

  it("if init fails the app is still there, and the message says to run init yourself", async () => {
    const { install } = recorder(2, "deploy init");

    const result = await runCreate(["my-app", "--deploy", "bogus"], { cwd, userAgent: "pnpm/11.25.0", install });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("run `blix deploy init` yourself (the app itself is ready)");
    expect(existsSync(join(cwd, "my-app", "src", "main.ts"))).toBe(true);
  });

  it("if an install fails, no later step runs", async () => {
    const { calls, install } = recorder(5, "typescript");

    const result = await runCreate(["my-app", "--deploy", "docker"], { cwd, userAgent: "pnpm/11.25.0", install });

    expect(result.exitCode).toBe(5);
    expect(result.stderr).toContain("run the install yourself");
    expect(calls).toHaveLength(2);
  });

  it("documents the flags in --help", async () => {
    const result = await runCreate(["--help"], { cwd });

    expect(result.stdout).toContain("--deploy <target>");
    expect(result.stdout).toContain("--ci <provider>");
  });
});
