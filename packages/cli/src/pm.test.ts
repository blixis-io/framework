import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addDevDependencyArgs, detectPackageManager } from "./pm.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "blix-pm-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("detectPackageManager", () => {
  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ] as const)("%s -> %s", (lockfile, expected) => {
    writeFileSync(join(root, lockfile), "");

    expect(detectPackageManager(root)).toBe(expected);
  });

  it("finds the lockfile of a parent workspace root", () => {
    writeFileSync(join(root, "pnpm-lock.yaml"), "");
    const nested = join(root, "packages", "api");
    mkdirSync(nested, { recursive: true });

    expect(detectPackageManager(nested)).toBe("pnpm");
  });

  it("defaults to npm when no lockfile exists anywhere above", () => {
    // tmpdir has no lockfile above it on a normal machine; the assertion is the default.
    expect(detectPackageManager(join(root, "nowhere"))).toBe("npm");
  });
});

describe("addDevDependencyArgs", () => {
  it.each([
    ["pnpm", ["add", "-D", "x"]],
    ["yarn", ["add", "-D", "x"]],
    ["bun", ["add", "-d", "x"]],
    ["npm", ["install", "-D", "x"]],
  ] as const)("%s", (pm, expected) => {
    expect(addDevDependencyArgs(pm, "x")).toEqual(expected);
  });
});
