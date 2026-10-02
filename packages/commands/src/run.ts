import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { getCommandOptions, getParamSources, type CommandOptions, type ParamSource } from "./decorators.js";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RegisteredCommand {
  options: CommandOptions;
  instance: { run?: (...args: never[]) => unknown };
}

/** Instance and token pairs, as `Application.resolved()` returns them. */
type Resolved = ReadonlyArray<readonly [unknown, unknown]>;

/** Finds every provider instance carrying `@Command`. Two commands with one name is an error, not a coin toss. */
export function discoverCommands(resolved: Resolved): RegisteredCommand[] {
  const found = new Map<string, RegisteredCommand>();
  for (const [, instance] of resolved) {
    if (typeof instance !== "object" || instance === null) {
      continue;
    }
    const options = getCommandOptions(instance.constructor);
    if (!options) {
      continue;
    }
    const existing = found.get(options.name);
    if (existing) {
      throw new Error(`Two commands are named "${options.name}": ${existing.instance.constructor.name} and ${instance.constructor.name}.`);
    }
    found.set(options.name, { options, instance });
  }
  return [...found.values()].toSorted((a, b) => a.options.name.localeCompare(b.options.name));
}

const fail = (message: string, exitCode = 1): CommandResult => ({ exitCode, stdout: "", stderr: `${message}\n` });

export function listCommands(commands: readonly RegisteredCommand[]): string {
  if (commands.length === 0) {
    return "No commands found. Decorate a class with @Command({ name }) and add it to a module's providers.\n";
  }
  const width = Math.max(...commands.map((command) => command.options.name.length));
  const lines = commands.map((command) => `  ${command.options.name.padEnd(width)}  ${command.options.description ?? ""}`.trimEnd());
  return `Commands:\n${lines.join("\n")}\n\nRun \`blix run <command> --help\` for a command's options.\n`;
}

function sourcesOf(command: RegisteredCommand): ParamSource[] {
  const prototype: unknown = Object.getPrototypeOf(command.instance);
  if (typeof prototype !== "object" || prototype === null) {
    return [];
  }
  return [...getParamSources(prototype).entries()].toSorted(([a], [b]) => a - b).map(([, source]) => source);
}

/** `--help` text generated from the decorators. */
export function helpFor(command: RegisteredCommand): string {
  const sources = sourcesOf(command);
  const args = sources.filter((source) => source.kind === "argument");
  const options = sources.filter((source) => source.kind === "option");

  const usage = ["blix run", command.options.name, ...(options.length > 0 ? ["[options]"] : []), ...args.map((arg) => (arg.required ? `<${arg.name}>` : `[${arg.name}]`))].join(" ");
  const out = [`${command.options.name}${command.options.description ? ` - ${command.options.description}` : ""}`, "", `Usage: ${usage}`];

  if (args.length > 0) {
    out.push("", "Arguments:", ...args.map((arg) => `  ${arg.name.padEnd(16)}${arg.description ?? ""}${arg.required ? " (required)" : ""}`.trimEnd()));
  }
  const rows = options.map((option) => {
    const label = `${option.short ? `-${option.short}, ` : "    "}--${option.name}${option.type === "boolean" ? "" : ` <${option.type ?? "string"}>`}`;
    const notes = [option.description, option.required ? "(required)" : undefined, option.default !== undefined ? `(default: ${String(option.default)})` : undefined].filter(Boolean).join(" ");
    return `  ${label.padEnd(26)}${notes}`.trimEnd();
  });
  out.push("", "Options:", ...rows, `  ${"-h, --help".padEnd(26)}Show this help`);
  return `${out.join("\n")}\n`;
}

const defaultOf = (source: ParamSource): string | number | boolean | undefined => (source.kind === "option" ? source.default : undefined);

const labelOf = (source: ParamSource): string => (source.kind === "option" ? `--${source.name}` : `<${source.name}>`);

/** One raw parsed value to the declared type, or a usage error. */
function coerce(raw: string | boolean | undefined, source: ParamSource): string | number | boolean | undefined | CommandResult {
  if (raw === undefined) {
    return source.kind === "option" && source.type === "boolean" ? (source.default ?? false) : defaultOf(source);
  }
  if (typeof raw === "boolean") {
    return raw;
  }
  if (source.type === "number") {
    const value = Number(raw);
    return raw.trim() === "" || Number.isNaN(value) ? fail(`${labelOf(source)} must be a number, got "${raw}".`) : value;
  }
  return raw;
}

/** Runs one command with `argv` (everything after its name). Output goes where the command writes it; this returns the exit code and any usage text. */
export async function runCommand(command: RegisteredCommand, argv: readonly string[]): Promise<CommandResult> {
  const sources = sourcesOf(command);
  const optionConfig: ParseArgsOptionsConfig = { help: { type: "boolean", short: "h" } };
  for (const source of sources) {
    if (source.kind === "option") {
      optionConfig[source.name] = {
        type: source.type === "boolean" ? "boolean" : "string",
        ...(source.short ? { short: source.short } : {}),
        ...(source.multiple ? { multiple: true } : {}),
      };
    }
  }

  let parsed;
  try {
    parsed = parseArgs({ args: [...argv], options: optionConfig, allowPositionals: true, strict: true });
  } catch (error) {
    return fail(`${error instanceof Error ? error.message : String(error)}\nTry \`blix run ${command.options.name} --help\`.`);
  }
  if (parsed.values["help"] === true) {
    return { exitCode: 0, stdout: helpFor(command), stderr: "" };
  }

  const declaredArguments = sources.filter((source) => source.kind === "argument");
  if (parsed.positionals.length > declaredArguments.length) {
    return fail(`Unexpected argument "${parsed.positionals[declaredArguments.length]}".\nTry \`blix run ${command.options.name} --help\`.`);
  }

  let nextPositional = 0;
  const values: unknown[] = [];
  for (const source of sources) {
    const raw = source.kind === "argument" ? parsed.positionals[nextPositional++] : parsed.values[source.name];

    if (raw === undefined && source.required && defaultOf(source) === undefined) {
      return fail(`Missing required ${source.kind} ${labelOf(source)}.\nTry \`blix run ${command.options.name} --help\`.`);
    }

    if (Array.isArray(raw)) {
      const items: unknown[] = [];
      for (const item of raw) {
        const value = coerce(typeof item === "string" || typeof item === "boolean" ? item : undefined, source);
        if (typeof value === "object" && value !== null) {
          return value;
        }
        items.push(value);
      }
      values.push(items);
      continue;
    }

    const value = coerce(typeof raw === "string" || typeof raw === "boolean" ? raw : undefined, source);
    if (typeof value === "object" && value !== null) {
      return value;
    }
    values.push(value);
  }

  const run = command.instance.run;
  if (typeof run !== "function") {
    return fail(`${command.instance.constructor.name} is marked @Command but has no run() method.`);
  }
  try {
    const result: unknown = await Reflect.apply(run, command.instance, values);
    return { exitCode: typeof result === "number" ? result : 0, stdout: "", stderr: "" };
  } catch (error) {
    return fail(`${command.options.name} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
