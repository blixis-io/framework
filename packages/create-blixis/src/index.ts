#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { pathToFileURL } from "node:url";
import { ScaffoldError, scaffold } from "./scaffold.js";
import { DEV_DEPENDENCIES, RUNTIME_DEPENDENCIES } from "./template.js";

const USAGE = `create-blixis <directory> [--no-install]

  pnpm create blixis my-app
  npm create blixis@latest my-app

  --no-install   write the files only; print the install commands instead
`;

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

export interface CreateResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs one package-manager command; resolves with its exit code. Injected so tests never touch the network. */
export type InstallRunner = (command: string, args: readonly string[], cwd: string) => Promise<number>;

export interface CreateOptions {
  cwd: string;
  /** `npm_config_user_agent` — tells us which package manager invoked `create`. */
  userAgent?: string | undefined;
  install?: InstallRunner;
}

export function detectPackageManager(userAgent: string | undefined): PackageManager {
  const name = userAgent?.split("/")[0];
  return name === "pnpm" || name === "yarn" || name === "bun" ? name : "npm";
}

function addArgs(pm: PackageManager, dev: boolean, packages: readonly string[]): string[] {
  const verb = pm === "npm" ? "install" : "add";
  const devFlag = pm === "bun" ? "-d" : "-D";
  return [verb, ...(dev ? [devFlag] : []), ...packages];
}

const runWithInheritedStdio: InstallRunner = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve(code ?? 1);
    });
  });

/** The whole CLI as a function of argv + environment — no process.exit()/console.log(), so it is directly testable. */
export async function runCreate(argv: readonly string[], options: CreateOptions): Promise<CreateResult> {
  const flags = argv.filter((arg) => arg.startsWith("-"));
  const [target, ...extra] = argv.filter((arg) => !arg.startsWith("-"));

  if (flags.includes("--help") || flags.includes("-h")) {
    return { exitCode: 0, stdout: USAGE, stderr: "" };
  }
  const unknown = flags.find((flag) => flag !== "--no-install");
  if (unknown) {
    return { exitCode: 1, stdout: "", stderr: `Unknown option "${unknown}"\n\n${USAGE}` };
  }
  if (!target || extra.length > 0) {
    return { exitCode: 1, stdout: "", stderr: `Usage: ${USAGE}` };
  }

  let result;
  try {
    result = scaffold(options.cwd, target);
  } catch (error) {
    if (error instanceof ScaffoldError) {
      return { exitCode: 1, stdout: "", stderr: `${error.message}\n` };
    }
    throw error;
  }

  const pm = detectPackageManager(options.userAgent);
  const runtime = addArgs(pm, false, RUNTIME_DEPENDENCIES);
  const dev = addArgs(pm, true, DEV_DEPENDENCIES);
  const dir = relative(options.cwd, result.directory) || ".";
  let stdout = `Created ${result.packageName} in ${dir}\n`;

  if (flags.includes("--no-install")) {
    stdout += `\nNext:\n  cd ${dir}\n  ${pm} ${runtime.join(" ")}\n  ${pm} ${dev.join(" ")}\n`;
  } else {
    const install = options.install ?? runWithInheritedStdio;
    for (const args of [runtime, dev]) {
      const code = await install(pm, args, result.directory);
      if (code !== 0) {
        return {
          exitCode: code,
          stdout,
          stderr: `\n"${pm} ${args.join(" ")}" failed (exit ${code}). The files are in ${dir}; run the install yourself.\n`,
        };
      }
    }
    const run = pm === "npm" ? "npm run" : pm;
    stdout += `\nNext:\n  cd ${dir}\n  ${run} dev\n  curl http://localhost:3000/hello/world\n`;
  }

  return { exitCode: 0, stdout, stderr: "" };
}

// Same entry-point check as @blixis-io/cli: pathToFileURL(realpathSync(...)) so a
// bin shim's symlink and a path with spaces both still match import.meta.url.
/* v8 ignore start -- @preserve: process wiring, exercised by index.test.ts spawning the real built binary */
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const result = await runCreate(process.argv.slice(2), {
    cwd: process.cwd(),
    userAgent: process.env["npm_config_user_agent"],
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.exitCode;
}
/* v8 ignore stop */
