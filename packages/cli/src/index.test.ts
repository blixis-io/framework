import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installFakePlugin } from "./test-helpers.js";
import { runCli } from "./index.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "blix-cli-test-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("runCli", () => {
  it("prints usage and exits 0 with no command", async () => {
    const result = await runCli([], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("blix generate <type> <name>");
  });

  it("prints usage and exits 0 for --help / -h", async () => {
    expect((await runCli(["--help"], cwd)).stdout).toContain("blix generate");
    expect((await runCli(["-h"], cwd)).stdout).toContain("blix generate");
  });

  it("exits 1 with an error for an unknown command", async () => {
    const result = await runCli(["bogus"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown command "bogus"');
  });

  it("exits 1 with usage when generate is missing type or name", async () => {
    const result = await runCli(["generate", "controller"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage: blix generate <type> <name>");
  });

  it("exits 1 for an unknown generator type", async () => {
    const result = await runCli(["generate", "bogus", "posts"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown type "bogus"');
  });

  it("generates a file and reports the relative path, via the g alias", async () => {
    const result = await runCli(["g", "controller", "posts"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("created src/posts/posts.controller.ts\n");
    expect(existsSync(join(cwd, "src", "posts", "posts.controller.ts"))).toBe(true);
  });

  it("--dry-run prints the path and content without writing", async () => {
    const result = await runCli(["generate", "service", "posts", "--dry-run"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Would create src/posts/posts.service.ts:");
    expect(result.stdout).toContain("export class PostsService {}");
    expect(existsSync(join(cwd, "src", "posts", "posts.service.ts"))).toBe(false);
  });

  it("exits 1 when refusing to overwrite an existing file without --force", async () => {
    await runCli(["generate", "module", "posts"], cwd);

    const result = await runCli(["generate", "module", "posts"], cwd);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("already exists");
  });

  it("--force overwrites an existing file", async () => {
    await runCli(["generate", "module", "posts"], cwd);

    const result = await runCli(["generate", "module", "posts", "--force"], cwd);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("created");
  });
});

describe("runCli: version, help and plugins", () => {
  it("prints the package version", async () => {
    const result = await runCli(["--version"], cwd);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
    expect((await runCli(["-v"], cwd)).stdout).toBe(result.stdout);
  });

  it("lists the add command and the plugin commands in the help", async () => {
    const result = await runCli(["--help"], cwd);

    expect(result.stdout).toContain("blix add <plugin>");
    expect(result.stdout).toContain("blix deploy");
    expect(result.stdout).toContain("@blixis-io/deploy");
    expect(result.stdout).toContain("blix run");
    expect(result.stdout).toContain("@blixis-io/commands");
  });

  it("runs an installed plugin with its args, cwd and loaded config", async () => {
    installFakePlugin(cwd, "deploy");
    writeFileSync(join(cwd, "blix.config.ts"), 'export default { deploy: { target: "docker" } };\n');

    const result = await runCli(["deploy", "--dry-run", "prod"], cwd);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ args: ["--dry-run", "prod"], cwd, config: { deploy: { target: "docker" } } });
  });

  it("runs a plugin without a config file, passing config as undefined", async () => {
    installFakePlugin(cwd, "deploy");

    expect(JSON.parse((await runCli(["deploy"], cwd)).stdout)).toMatchObject({ args: [], config: null });
  });

  it("surfaces a broken config as an error without running the plugin", async () => {
    installFakePlugin(cwd, "deploy");
    writeFileSync(join(cwd, "blix.config.json"), "{nope");

    const result = await runCli(["deploy"], cwd);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Could not load blix.config.json");
  });

  it("does not need a valid config for built-in commands", async () => {
    writeFileSync(join(cwd, "blix.config.json"), "{nope");

    expect((await runCli(["generate", "service", "posts"], cwd)).exitCode).toBe(0);
  });

  it("turns a plugin that throws into a clean error", async () => {
    installFakePlugin(
      cwd,
      "deploy",
      'export const blixCommand = { name: "deploy", description: "x", run() { throw new Error("kaboom"); } };\n',
    );

    const result = await runCli(["deploy"], cwd);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("blix deploy failed: kaboom\n");
  });

  it("reports an installed-but-broken plugin", async () => {
    installFakePlugin(cwd, "deploy", "export const nothing = 1;\n");

    const result = await runCli(["deploy"], cwd);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Could not load @blixis-io/deploy");
  });

  it("add installs through the injected runner", async () => {
    const calls: (readonly string[])[] = [];

    const result = await runCli(["add", "deploy"], cwd, {
      install: (_command, args) => {
        calls.push(args);
        return Promise.resolve(0);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([["install", "-D", "@blixis-io/deploy"]]);
  });
});

describe("the real built CLI (spawned, not imported)", () => {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const distEntry = join(packageRoot, "dist", "bin.js");
  const libraryEntry = join(packageRoot, "dist", "index.js");

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

  it("runs a plugin from the project's node_modules with a real blix.config.ts", () => {
    installFakePlugin(cwd, "deploy");
    writeFileSync(join(cwd, "blix.config.ts"), 'export default { deploy: { target: "vercel" } };\n');

    const stdout = execFileSync("node", [distEntry, "deploy", "prod"], { cwd, encoding: "utf8" });

    expect(JSON.parse(stdout)).toMatchObject({ args: ["prod"], config: { deploy: { target: "vercel" } } });
  });

  it("tells you how to install a plugin that is missing (real Node resolution from the project)", () => {
    // Vitest (and pnpm) put the repo's node_modules on NODE_PATH, which would let a temp dir "find" this repo's own workspace packages.
    const result = spawnSync("node", [distEntry, "deploy"], { cwd, encoding: "utf8", env: { ...process.env, NODE_PATH: "" } });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("needs @blixis-io/deploy");
    expect(result.stderr).toContain("blix add deploy");
  });

  /** Makes `@blixis-io/cli` importable from the temp project, the way a real install would. */
  function linkCliIntoProject(): void {
    mkdirSync(join(cwd, "node_modules", "@blixis-io"), { recursive: true });
    symlinkSync(packageRoot, join(cwd, "node_modules", "@blixis-io", "cli"));
  }

  it("the library entry has no shebang and can be imported without running the CLI", () => {
    const stdout = execFileSync("node", ["-e", `import(${JSON.stringify(libraryEntry)}).then((m) => console.log(typeof m.runCli, typeof m.defineConfig))`], { cwd, encoding: "utf8" });

    expect(stdout).toBe("function function\n");
  });

  it("regression: a blix.config.ts that imports defineConfig from @blixis-io/cli doesn't deadlock the binary", () => {
    // The bin used to be the same file as the library entry, so importing the library from the
    // config while the bin was mid-`await runCli()` waited on itself forever (exit 13, unsettled top-level await).
    linkCliIntoProject();
    installFakePlugin(cwd, "deploy");
    writeFileSync(
      join(cwd, "blix.config.ts"),
      'import { defineConfig } from "@blixis-io/cli";\nexport default defineConfig({ deploy: { target: "docker" } });\n',
    );

    const result = spawnSync("node", [distEntry, "deploy", "prod"], { cwd, encoding: "utf8", timeout: 20_000 });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ args: ["prod"], config: { deploy: { target: "docker" } } });
  });

  it("regression: a plugin that imports @blixis-io/cli at runtime doesn't deadlock the binary either", () => {
    linkCliIntoProject();
    installFakePlugin(
      cwd,
      "deploy",
      `import { detectPackageManager } from "@blixis-io/cli";
export const blixCommand = { name: "deploy", description: "x", run: ({ cwd }) => ({ exitCode: 0, stdout: detectPackageManager(cwd) + "\\n", stderr: "" }) };
`,
    );

    const result = spawnSync("node", [distEntry, "deploy"], { cwd, encoding: "utf8", timeout: 20_000 });

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("npm\n");
  });

  it("prints its version", () => {
    expect(execFileSync("node", [distEntry, "--version"], { cwd, encoding: "utf8" })).toMatch(/^\d+\.\d+\.\d+\n$/);
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

describe("blix doctor wiring", () => {
  it("is listed in usage and dispatched", async () => {
    expect((await runCli(["--help"], process.cwd())).stdout).toContain("blix doctor");
    const result = await runCli(["doctor"], "/nonexistent-dir-for-doctor");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("no readable package.json");
  });
});
