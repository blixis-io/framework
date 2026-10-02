#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { pathToFileURL } from "node:url";
import { ScaffoldError, scaffold } from "./scaffold.js";
import { DEPLOY_DEPENDENCIES, DEV_DEPENDENCIES, RUNTIME_DEPENDENCIES } from "./template.js";

const USAGE = `create-blixis <directory> [--deploy <target>] [--ci <provider>] [--no-install]

  pnpm create blixis my-app
  npm create blixis@latest my-app
  pnpm create blixis my-app --deploy docker --ci github

  --deploy <target>   also set up deployment (docker, vercel, netlify or cloudflare): installs
                      @blixis-io/cli and @blixis-io/deploy and runs \`blix deploy init\`
  --ci <provider>     with --deploy: also write the CI pipeline (github, gitlab or bitbucket)
  --no-install        write the files only; print the install commands instead
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

/** `"pnpm@11.25.0"` from an `npm_config_user_agent` like `pnpm/11.25.0 npm/? node/v24.0.0`, for the `packageManager` field. Bun isn't managed by corepack, so it gets none. */
export function packageManagerPin(userAgent: string | undefined): string | undefined {
  const match = /^(pnpm|npm|yarn)\/(\d+\.\d+\.\d+)/.exec(userAgent ?? "");
  return match ? `${match[1]}@${match[2]}` : undefined;
}

function addArgs(pm: PackageManager, dev: boolean, packages: readonly string[]): string[] {
  const verb = pm === "npm" ? "install" : "add";
  const devFlag = pm === "bun" ? "-d" : "-D";
  return [verb, ...(dev ? [devFlag] : []), ...packages];
}

/** The command that runs a locally installed binary (`blix`), per package manager. */
function execBlix(pm: PackageManager, args: readonly string[]): { command: string; args: string[] } {
  switch (pm) {
    case "pnpm":
      return { command: "pnpm", args: ["exec", "blix", ...args] };
    case "npm":
      return { command: "npx", args: ["blix", ...args] };
    case "yarn":
      return { command: "yarn", args: ["blix", ...args] };
    case "bun":
      return { command: "bunx", args: ["blix", ...args] };
    /* v8 ignore start -- @preserve: exhaustiveness guard, unreachable while every package manager has a case */
    default: {
      const unreachable: never = pm;
      throw new Error(`Unknown package manager ${String(unreachable)}`);
    }
    /* v8 ignore stop */
  }
}

interface ParsedArgs {
  positionals: string[];
  noInstall: boolean;
  help: boolean;
  deploy?: string | undefined;
  ci?: string | undefined;
  error?: string | undefined;
}

const VALUE_FLAGS = new Set(["deploy", "ci"]);

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { positionals: [], noInstall: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--no-install") {
      parsed.noInstall = true;
    } else if (arg.startsWith("--")) {
      const [name = "", inline] = arg.slice(2).split(/=(.*)/s);
      if (!VALUE_FLAGS.has(name)) {
        parsed.error ??= `Unknown option "${arg}"`;
        continue;
      }
      const value = inline ?? argv[++index];
      if (value === undefined || value.startsWith("-")) {
        parsed.error ??= `--${name} needs a value`;
        continue;
      }
      if (name === "deploy") {
        parsed.deploy = value;
      } else {
        parsed.ci = value;
      }
    } else if (arg.startsWith("-")) {
      parsed.error ??= `Unknown option "${arg}"`;
    } else {
      parsed.positionals.push(arg);
    }
  }
  return parsed;
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
  const parsed = parseArgs(argv);
  const [target, ...extra] = parsed.positionals;

  if (parsed.help) {
    return { exitCode: 0, stdout: USAGE, stderr: "" };
  }
  if (parsed.error) {
    return { exitCode: 1, stdout: "", stderr: `${parsed.error}\n\n${USAGE}` };
  }
  if (!target || extra.length > 0) {
    return { exitCode: 1, stdout: "", stderr: `Usage: ${USAGE}` };
  }
  if (parsed.ci && !parsed.deploy) {
    return { exitCode: 1, stdout: "", stderr: `--ci only makes sense with --deploy <target>.\n\n${USAGE}` };
  }

  let result;
  try {
    result = scaffold(options.cwd, target, packageManagerPin(options.userAgent));
  } catch (error) {
    if (error instanceof ScaffoldError) {
      return { exitCode: 1, stdout: "", stderr: `${error.message}\n` };
    }
    throw error;
  }

  const pm = detectPackageManager(options.userAgent);
  const runtime = addArgs(pm, false, RUNTIME_DEPENDENCIES);
  const dev = addArgs(pm, true, DEV_DEPENDENCIES);
  const deployDev = addArgs(pm, true, DEPLOY_DEPENDENCIES);
  const initArgs = parsed.deploy ? ["deploy", "init", "--target", parsed.deploy, ...(parsed.ci ? ["--ci", parsed.ci] : [])] : [];
  const blixInit = execBlix(pm, initArgs);
  const dir = relative(options.cwd, result.directory) || ".";
  let stdout = `Created ${result.packageName} in ${dir}\n`;

  if (parsed.noInstall) {
    stdout += `\nNext:\n  cd ${dir}\n  ${pm} ${runtime.join(" ")}\n  ${pm} ${dev.join(" ")}\n`;
    if (parsed.deploy) {
      stdout += `  ${pm} ${deployDev.join(" ")}\n  ${blixInit.command} ${blixInit.args.join(" ")}\n`;
    }
    return { exitCode: 0, stdout, stderr: "" };
  }

  const install = options.install ?? runWithInheritedStdio;
  const steps: { command: string; args: readonly string[] }[] = [
    { command: pm, args: runtime },
    { command: pm, args: dev },
    ...(parsed.deploy ? [{ command: pm, args: deployDev }, blixInit] : []),
  ];
  for (const step of steps) {
    const code = await install(step.command, step.args, result.directory);
    if (code !== 0) {
      const isInit = parsed.deploy !== undefined && step === steps.at(-1);
      return {
        exitCode: code,
        stdout,
        stderr: `\n"${step.command} ${step.args.join(" ")}" failed (exit ${code}). The files are in ${dir}; ${
          isInit ? "run `blix deploy init` yourself (the app itself is ready)." : "run the install yourself."
        }\n`,
      };
    }
  }

  const run = pm === "npm" ? "npm run" : pm;
  stdout += `\nNext:\n  cd ${dir}\n  ${run} dev\n  curl http://localhost:3000/hello/world\n`;
  if (parsed.deploy) {
    const dryRun = execBlix(pm, ["deploy", "--dry-run"]);
    stdout += `\nDeploy (${parsed.deploy}${parsed.ci ? `, ${parsed.ci}` : ""}):\n  review blix.config.ts, then\n  ${dryRun.command} ${dryRun.args.join(" ")}\n`;
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
