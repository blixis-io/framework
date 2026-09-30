import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "./index.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "blix-cli-test-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("runCli", () => {
  it("prints usage and exits 0 with no command", () => {
    const result = runCli([], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("blix generate <type> <name>");
  });

  it("prints usage and exits 0 for --help / -h", () => {
    expect(runCli(["--help"], cwd).stdout).toContain("blix generate");
    expect(runCli(["-h"], cwd).stdout).toContain("blix generate");
  });

  it("exits 1 with an error for an unknown command", () => {
    const result = runCli(["bogus"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown command "bogus"');
  });

  it("exits 1 with usage when generate is missing type or name", () => {
    const result = runCli(["generate", "controller"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage: blix generate <type> <name>");
  });

  it("exits 1 for an unknown generator type", () => {
    const result = runCli(["generate", "bogus", "posts"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown type "bogus"');
  });

  it("generates a file and reports the relative path, via the g alias", () => {
    const result = runCli(["g", "controller", "posts"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("created src/posts/posts.controller.ts\n");
    expect(existsSync(join(cwd, "src", "posts", "posts.controller.ts"))).toBe(true);
  });

  it("--dry-run prints the path and content without writing", () => {
    const result = runCli(["generate", "service", "posts", "--dry-run"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Would create src/posts/posts.service.ts:");
    expect(result.stdout).toContain("export class PostsService {}");
    expect(existsSync(join(cwd, "src", "posts", "posts.service.ts"))).toBe(false);
  });

  it("exits 1 when refusing to overwrite an existing file without --force", () => {
    runCli(["generate", "module", "posts"], cwd);

    const result = runCli(["generate", "module", "posts"], cwd);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("already exists");
  });

  it("--force overwrites an existing file", () => {
    runCli(["generate", "module", "posts"], cwd);

    const result = runCli(["generate", "module", "posts", "--force"], cwd);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("created");
  });
});

describe("the real built CLI (spawned, not imported)", () => {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const distEntry = join(packageRoot, "dist", "index.js");

  beforeAll(() => {
    // Self-contained on purpose: turbo's `test` task doesn't depend on
    // `build` in this repo's turbo.json, so a `pnpm run ci` invocation
    // gives no guarantee dist/ already exists by the time this file runs.
    execFileSync("pnpm", ["run", "build"], { cwd: packageRoot, stdio: "ignore" });
  }, 30_000);

  it("keeps its shebang after bundling", () => {
    const firstLine = execFileSync("head", ["-n", "1", distEntry], { encoding: "utf8" });
    expect(firstLine).toBe("#!/usr/bin/env node\n");
  });

  it("runs end to end: real process, real argv, real file write", () => {
    const stdout = execFileSync("node", [distEntry, "generate", "controller", "posts"], { cwd, encoding: "utf8" });

    expect(stdout).toBe("created src/posts/posts.controller.ts\n");
    expect(existsSync(join(cwd, "src", "posts", "posts.controller.ts"))).toBe(true);
  });

  it("exits non-zero on a real error", () => {
    expect(() => execFileSync("node", [distEntry, "generate", "bogus", "posts"], { cwd, stdio: "pipe" })).toThrow(
      "Command failed",
    );
  });

  it("still runs when invoked through a symlink, like a package manager's bin shim", () => {
    // Regression test: import.meta.url resolves through a symlink, but
    // process.argv[1] as typed on the command line doesn't unless resolved
    // the same way first (realpathSync) — this is exactly what pnpm's own
    // node_modules/.bin/blix shim does, and the naive version of this
    // entry-point check silently no-op'd (exited 0, wrote nothing) under it.
    const linkPath = join(cwd, "blix-link.js");
    symlinkSync(distEntry, linkPath);

    const stdout = execFileSync("node", [linkPath, "generate", "service", "posts"], { cwd, encoding: "utf8" });

    expect(stdout).toBe("created src/posts/posts.service.ts\n");
    expect(existsSync(join(cwd, "src", "posts", "posts.service.ts"))).toBe(true);
  });
});
