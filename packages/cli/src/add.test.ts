import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAdd, spawnInstall } from "./add.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "blix-add-test-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("runAdd", () => {
  it("installs the plugin as a dev dependency with the project's package manager", async () => {
    writeFileSync(join(cwd, "pnpm-lock.yaml"), "");
    const calls: { command: string; args: readonly string[]; cwd: string }[] = [];

    const result = await runAdd(["deploy"], cwd, (command, args, where) => {
      calls.push({ command, args, cwd: where });
      return Promise.resolve(0);
    });

    expect(calls).toEqual([{ command: "pnpm", args: ["add", "-D", "@blixis-io/deploy"], cwd }]);
    expect(result).toEqual({ exitCode: 0, stdout: "Added @blixis-io/deploy. Next: blix deploy --help\n", stderr: "" });
  });

  it("uses npm install when there is no lockfile", async () => {
    const calls: (readonly string[])[] = [];

    await runAdd(["deploy"], cwd, (_command, args) => {
      calls.push(args);
      return Promise.resolve(0);
    });

    expect(calls[0]).toEqual(["install", "-D", "@blixis-io/deploy"]);
  });

  it("reports a failed install with its exit code", async () => {
    const result = await runAdd(["deploy"], cwd, () => Promise.resolve(3));

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("failed (exit 3)");
  });

  it("installs the commands package for `blix add run`", async () => {
    const calls: (readonly string[])[] = [];

    const result = await runAdd(["run"], cwd, (_command, args) => {
      calls.push(args);
      return Promise.resolve(0);
    });

    expect(calls).toEqual([["install", "-D", "@blixis-io/commands"]]);
    expect(result.stdout).toBe("Added @blixis-io/commands. Next: blix run --help\n");
  });

  it("lists the available plugins for an unknown name", async () => {
    const result = await runAdd(["bogus"], cwd, () => Promise.resolve(0));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown plugin "bogus". Available: deploy, run');
  });

  it("shows usage when no plugin is named", async () => {
    const result = await runAdd([], cwd, () => Promise.resolve(0));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage: blix add <plugin>");
  });
});

describe("spawnInstall", () => {
  it("resolves with the real exit code of the spawned process", async () => {
    await expect(spawnInstall("node", ["-e", "process.exit(0)"], cwd)).resolves.toBe(0);
    await expect(spawnInstall("node", ["-e", "process.exit(3)"], cwd)).resolves.toBe(3);
  });

  it("runs in the given directory", async () => {
    const code = await spawnInstall("node", ["-e", `process.exit(process.cwd() === require("fs").realpathSync(${JSON.stringify(cwd)}) ? 0 : 9)`], cwd);

    expect(code).toBe(0);
  });

  it("rejects when the command doesn't exist", async () => {
    await expect(spawnInstall("blix-no-such-command-xyz", [], cwd)).rejects.toThrow("ENOENT");
  });
});
