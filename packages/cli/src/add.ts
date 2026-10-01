import { spawn } from "node:child_process";
import { addDevDependencyArgs, detectPackageManager } from "./pm.js";
import { KNOWN_PLUGINS } from "./plugins.js";
import type { CliResult } from "./types.js";

/** Runs one package-manager command; resolves with its exit code. Injected so tests never touch the network. */
export type InstallRunner = (command: string, args: readonly string[], cwd: string) => Promise<number>;

export const spawnInstall: InstallRunner = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve(code ?? 1);
    });
  });

/** `blix add <plugin>`: installs a plugin package as a dev dependency with the project's own package manager. */
export async function runAdd(args: readonly string[], cwd: string, install: InstallRunner): Promise<CliResult> {
  const name = args[0];
  const plugin = name ? KNOWN_PLUGINS[name] : undefined;

  if (!name || !plugin) {
    const available = Object.keys(KNOWN_PLUGINS).join(", ");
    const subject = name ? `Unknown plugin "${name}"` : "Usage: blix add <plugin>";
    return { exitCode: 1, stdout: "", stderr: `${subject}. Available: ${available}\n` };
  }

  const pm = detectPackageManager(cwd);
  const installArgs = addDevDependencyArgs(pm, plugin.package);
  const code = await install(pm, installArgs, cwd);
  if (code !== 0) {
    return { exitCode: code, stdout: "", stderr: `"${pm} ${installArgs.join(" ")}" failed (exit ${code}).\n` };
  }
  return { exitCode: 0, stdout: `Added ${plugin.package}. Next: blix ${name} --help\n`, stderr: "" };
}
