import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createApplication, type Application } from "@blixis-io/core";
import type { BlixCommand, CliResult, CommandContext } from "@blixis-io/cli";
import type { Class } from "@blixis-io/di";
import { discoverCommands, helpFor, listCommands, runCommand } from "./run.js";

export interface AppLocation {
  module: string;
  export: string;
}

export const DEFAULT_APP: AppLocation = { module: "dist/app.module.js", export: "AppModule" };

/** `app` from `blix.config.*`, with defaults. Throws a readable error for a malformed section. */
export function appLocation(config: Record<string, unknown> | undefined): AppLocation {
  const section = config?.["app"];
  if (section === undefined) {
    return DEFAULT_APP;
  }
  if (typeof section !== "object" || section === null) {
    throw new Error('blix.config "app" must be an object like { module: "dist/app.module.js", export: "AppModule" }.');
  }
  const module = "module" in section ? section.module : DEFAULT_APP.module;
  const name = "export" in section ? section.export : DEFAULT_APP.export;
  if (typeof module !== "string" || typeof name !== "string" || module === "" || name === "") {
    throw new Error('blix.config "app.module" and "app.export" must be non-empty strings.');
  }
  return { module, export: name };
}

function isClass(value: unknown): value is Class {
  return typeof value === "function";
}

/** Imports the compiled app module and boots it without listening: no sockets, just the module graph and its lifecycle hooks. */
export async function bootApplication(cwd: string, location: AppLocation): Promise<Application> {
  const path = resolve(cwd, location.module);
  let loaded: unknown;
  try {
    loaded = await import(pathToFileURL(path).href);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not load ${location.module}: ${reason}\nBuild your app first (the module path comes from "app.module" in blix.config, default ${DEFAULT_APP.module}).`, { cause: error });
  }
  const root: unknown = typeof loaded === "object" && loaded !== null ? Reflect.get(loaded, location.export) : undefined;
  if (!isClass(root)) {
    throw new Error(`${location.module} has no export named "${location.export}" (set "app.export" in blix.config).`);
  }
  return createApplication(root);
}

export interface RunDeps {
  boot(cwd: string, location: AppLocation): Promise<Pick<Application, "resolved" | "close">>;
}

const USAGE = `blix run                  list the commands in your app
blix run <command> [...]  run one (options and arguments come from its @Option / @Argument)
blix run <command> --help show that command's usage
`;

export async function runCommands(context: CommandContext, deps: RunDeps = { boot: bootApplication }): Promise<CliResult> {
  const [name, ...rest] = context.args;
  if (name === "--help" || name === "-h") {
    return { exitCode: 0, stdout: USAGE, stderr: "" };
  }

  let app: Pick<Application, "resolved" | "close">;
  try {
    app = await deps.boot(context.cwd, appLocation(context.config?.config));
  } catch (error) {
    return { exitCode: 1, stdout: "", stderr: `${error instanceof Error ? error.message : String(error)}\n` };
  }

  try {
    const commands = discoverCommands(app.resolved());
    if (name === undefined) {
      return { exitCode: 0, stdout: listCommands(commands), stderr: "" };
    }
    const command = commands.find((candidate) => candidate.options.name === name);
    if (!command) {
      return { exitCode: 1, stdout: "", stderr: `Unknown command "${name}".\n\n${listCommands(commands)}` };
    }
    return await runCommand(command, rest);
  } catch (error) {
    return { exitCode: 1, stdout: "", stderr: `${error instanceof Error ? error.message : String(error)}\n` };
  } finally {
    await app.close("command");
  }
}

/** What `blix run` loads. */
export const blixCommand: BlixCommand = {
  name: "run",
  description: "run an app command (@Command)",
  run: (context) => runCommands(context),
};

export { helpFor };
