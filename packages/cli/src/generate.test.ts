import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateFile, resolveOutputPath } from "./generate.js";
import { InvalidNameError } from "./names.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "blix-cli-test-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("resolveOutputPath", () => {
  it("nests into a per-resource folder by default", () => {
    expect(resolveOutputPath(cwd, "controller", "posts")).toBe(join(cwd, "src", "posts", "posts.controller.ts"));
  });

  it("writes flat, no subfolder, with --flat", () => {
    expect(resolveOutputPath(cwd, "controller", "posts", { flat: true })).toBe(
      join(cwd, "src", "posts.controller.ts"),
    );
  });

  it("normalizes the name for the path the same way as the class name", () => {
    expect(resolveOutputPath(cwd, "service", "PostTags")).toBe(join(cwd, "src", "post-tags", "post-tags.service.ts"));
  });
});

describe("generateFile", () => {
  it("creates the src/ and resource directories and writes the file", () => {
    const result = generateFile(cwd, "controller", "posts");

    expect(result.written).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    expect(readFileSync(result.path, "utf8")).toBe(result.content);
    expect(result.content).toContain("export class PostsController {");
  });

  it("refuses to overwrite an existing file without --force", () => {
    generateFile(cwd, "service", "posts");

    expect(() => generateFile(cwd, "service", "posts")).toThrow("already exists");
  });

  it("overwrites an existing file with --force", () => {
    generateFile(cwd, "service", "posts");

    const result = generateFile(cwd, "service", "posts", { force: true });

    expect(result.written).toBe(true);
  });

  it("--dry-run resolves the path and renders content without writing anything", () => {
    const result = generateFile(cwd, "module", "posts", { dryRun: true });

    expect(result.written).toBe(false);
    expect(existsSync(result.path)).toBe(false);
    expect(result.content).toContain("export class PostsModule {}");
  });

  it("does not error on a dry-run even when the file already exists", () => {
    generateFile(cwd, "guard", "posts");

    expect(() => generateFile(cwd, "guard", "posts", { dryRun: true })).not.toThrow();
  });
});

describe("generateFile: invalid names", () => {
  it.each(["123", "---", "café"])("refuses %s and writes nothing, even on a dry run", (name) => {
    expect(() => generateFile(cwd, "controller", name)).toThrow(InvalidNameError);
    expect(() => generateFile(cwd, "controller", name, { dryRun: true })).toThrow(InvalidNameError);
    expect(existsSync(join(cwd, "src"))).toBe(false);
  });
});
