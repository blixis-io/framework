import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LoadedConfig } from "./config.js";
import type { CliResult } from "./types.js";

export interface CommandContext {
  /** Everything after the command name. */
  args: readonly string[];
  cwd: string;
  /** `blix.config.*` from `cwd`, if there is one. */
  config: LoadedConfig | undefined;
}

/** What a `blix <command>` plugin package exports, as `blixCommand`. */
export interface BlixCommand {
  name: string;
  description: string;
  run(context: CommandContext): CliResult | Promise<CliResult>;
}

/** Commands that live in their own package, so the CLI itself stays dependency-free. */
export const KNOWN_PLUGINS: Readonly<Record<string, { package: string; description: string }>> = {
  deploy: { package: "@blixis-io/deploy", description: "build and deploy to Docker, Vercel, Netlify, Cloudflare ..." },
};

export type PluginLookup =
  | { kind: "loaded"; command: BlixCommand }
  | { kind: "not-installed"; packageName: string }
  | { kind: "invalid"; packageName: string; reason: string };

function isBlixCommand(value: unknown): value is BlixCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    "run" in value &&
    typeof value.run === "function"
  );
}

/** Finds the plugin in the *project's* node_modules (resolved from `cwd`, not from wherever this CLI is installed). `registry` exists so tests can name a package that is guaranteed not to exist. */
export async function loadPlugin(commandName: string, cwd: string, registry: typeof KNOWN_PLUGINS = KNOWN_PLUGINS): Promise<PluginLookup> {
  const known = registry[commandName];
  if (!known) {
    return { kind: "invalid", packageName: commandName, reason: "not a known command" };
  }

  let entry: string;
  try {
    entry = createRequire(join(cwd, "noop.js")).resolve(known.package);
  } catch {
    return { kind: "not-installed", packageName: known.package };
  }

  let loaded: unknown;
  try {
    loaded = await import(pathToFileURL(entry).href);
  } catch (error) {
    return { kind: "invalid", packageName: known.package, reason: error instanceof Error ? error.message : String(error) };
  }

  const command = typeof loaded === "object" && loaded !== null && "blixCommand" in loaded ? loaded.blixCommand : undefined;
  if (!isBlixCommand(command)) {
    return { kind: "invalid", packageName: known.package, reason: "it does not export a `blixCommand` with a run() function" };
  }
  return { kind: "loaded", command };
}
