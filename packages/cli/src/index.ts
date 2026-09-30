#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { pathToFileURL } from "node:url";
import { generateFile, type GenerateOptions } from "./generate.js";
import { GENERATOR_TYPES, resolveGeneratorType } from "./templates.js";

const USAGE = `blix generate <type> <name> [--flat] [--force] [--dry-run]
blix g <type> <name> [--flat] [--force] [--dry-run]

<type>: ${GENERATOR_TYPES.join(", ")} (or their first letter: c, s, m, g, i)

  --flat      write src/<name>.<type>.ts instead of src/<name>/<name>.<type>.ts
  --force     overwrite an existing file
  --dry-run   print what would be written, without writing it
`;

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
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
    return { exitCode: 1, stdout: "", stderr: `Usage: blix generate <type> <name>\n\n${USAGE}` };
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

/** The whole CLI, as a pure function of argv + cwd — no process.exit()/console.log() here, so it's directly testable. */
export function runCli(argv: readonly string[], cwd: string): CliResult {
  const [command, ...rest] = argv;

  if (command === "generate" || command === "g") {
    return runGenerate(cwd, rest);
  }
  if (!command || command === "--help" || command === "-h") {
    return { exitCode: 0, stdout: USAGE, stderr: "" };
  }
  return { exitCode: 1, stdout: "", stderr: `Unknown command "${command}"\n\n${USAGE}` };
}

// Only run for real when executed directly (not when imported by tests).
// pathToFileURL, not a manual `file://${...}` template — argv[1] is a raw
// filesystem path, not URL-encoded, so a path containing a space or other
// reserved character (this repo's own directory name, for instance) would
// never match import.meta.url's properly-encoded form otherwise. realpathSync
// matters too, separately: a package manager's bin shim (pnpm's own
// node_modules/.bin/blix, for one) invokes this file through a symlink;
// import.meta.url reflects the resolved real path, argv[1] doesn't unless
// resolved the same way first — Node's own docs recommend exactly this for
// "is this module the entry point" checks.
/* v8 ignore start -- @preserve: process wiring, exercised by index.test.ts spawning the real built CLI, not by importing this module */
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const result = runCli(process.argv.slice(2), process.cwd());
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.exitCode;
}
/* v8 ignore stop */
