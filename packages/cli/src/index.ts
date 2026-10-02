import { createRequire } from "node:module";
import { relative } from "node:path";
import { runAdd, spawnInstall, type InstallRunner } from "./add.js";
import { ConfigError, loadConfig } from "./config.js";
import { runDoctor } from "./doctor.js";
import { generateFile, type GenerateOptions } from "./generate.js";
import { KNOWN_PLUGINS, loadPlugin } from "./plugins.js";
import { GENERATOR_TYPES, resolveGeneratorType } from "./templates.js";
import type { CliResult } from "./types.js";

export { ConfigError, defineConfig, loadConfig, type BlixConfig, type LoadedConfig } from "./config.js";
export { addDevDependencyArgs, detectPackageManager, type PackageManager } from "./pm.js";
export { KNOWN_PLUGINS, type BlixCommand, type CommandContext } from "./plugins.js";
export type { InstallRunner } from "./add.js";
export type { CliResult } from "./types.js";

const GENERATE_USAGE = `blix generate <type> <name> [--flat] [--force] [--dry-run]
blix g <type> <name> [--flat] [--force] [--dry-run]

<type>: ${GENERATOR_TYPES.join(", ")} (or their first letter: c, s, m, g, i)

  --flat      write src/<name>.<type>.ts instead of src/<name>/<name>.<type>.ts
  --force     overwrite an existing file
  --dry-run   print what would be written, without writing it
`;

function usage(): string {
  const plugins = Object.entries(KNOWN_PLUGINS)
    .map(([name, plugin]) => `blix ${name.padEnd(10)}${plugin.description} (${plugin.package})`)
    .join("\n");
  return `${GENERATE_USAGE}
blix add <plugin>   install a plugin package (${Object.keys(KNOWN_PLUGINS).join(", ")})
blix doctor         check this project: decorator flags, duplicate @blixis-io copies, tooling
${plugins}

blix --version
`;
}


function parseFlags(args: readonly string[]): GenerateOptions {
  return {
    flat: args.includes("--flat"),
    force: args.includes("--force"),
    dryRun: args.includes("--dry-run"),
  };
}

function runGenerate(cwd: string, args: readonly string[]): CliResult {
  const [typeArg, name] = args.filter((arg) => !arg.startsWith("--"));

  if (!typeArg || !name) {
    return { exitCode: 1, stdout: "", stderr: `Usage: blix generate <type> <name>\n\n${GENERATE_USAGE}` };
  }

  const type = resolveGeneratorType(typeArg);
  if (!type) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Unknown type "${typeArg}" — expected one of: ${GENERATOR_TYPES.join(", ")}\n`,
    };
  }

  const options = parseFlags(args);

  try {
    const result = generateFile(cwd, type, name, options);
    const relativePath = relative(cwd, result.path);

    if (!result.written) {
      return { exitCode: 0, stdout: `Would create ${relativePath}:\n\n${result.content}`, stderr: "" };
    }
    return { exitCode: 0, stdout: `created ${relativePath}\n`, stderr: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: "", stderr: `${message}\n` };
  }
}

export interface RunCliOptions {
  /** Defaults to spawning the project's package manager; tests inject a fake. */
  install?: InstallRunner;
}

function packageVersion(): string {
  // `../package.json` resolves to the package root from both src/ and the bundled dist/.
  const manifest: unknown = createRequire(import.meta.url)("../package.json");
  return typeof manifest === "object" && manifest !== null && "version" in manifest && typeof manifest.version === "string"
    ? manifest.version
    : "unknown";
}

async function runPlugin(command: string, args: readonly string[], cwd: string): Promise<CliResult> {
  const lookup = await loadPlugin(command, cwd);

  if (lookup.kind === "not-installed") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `"blix ${command}" needs ${lookup.packageName}, which isn't installed in this project.\nInstall it with: blix add ${command}\n`,
    };
  }
  if (lookup.kind === "invalid") {
    return { exitCode: 1, stdout: "", stderr: `Could not load ${lookup.packageName}: ${lookup.reason}\n` };
  }

  try {
    const config = await loadConfig(cwd);
    return await lookup.command.run({ args, cwd, config });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: "", stderr: `${error instanceof ConfigError ? "" : `blix ${command} failed: `}${message}\n` };
  }
}

/** The whole CLI, as a function of argv + cwd — no process.exit()/console.log() here, so it's directly testable. */
export async function runCli(argv: readonly string[], cwd: string, options: RunCliOptions = {}): Promise<CliResult> {
  const [command, ...rest] = argv;

  if (command === "generate" || command === "g") {
    return runGenerate(cwd, rest);
  }
  if (command === "add") {
    return runAdd(rest, cwd, options.install ?? spawnInstall);
  }
  if (command === "doctor") {
    return runDoctor(cwd);
  }
  if (command === "--version" || command === "-v") {
    return { exitCode: 0, stdout: `${packageVersion()}\n`, stderr: "" };
  }
  if (!command || command === "--help" || command === "-h") {
    return { exitCode: 0, stdout: usage(), stderr: "" };
  }
  if (command in KNOWN_PLUGINS) {
    return runPlugin(command, rest, cwd);
  }
  return { exitCode: 1, stdout: "", stderr: `Unknown command "${command}"\n\n${usage()}` };
}
