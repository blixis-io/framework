import { defineMetadata, getMetadata, Injectable } from "@blixis-io/di";

export interface CommandOptions {
  /** What you type after `blix run`. Lower-case letters, digits, `-`, `:` and `.` (so `db:migrate` works). */
  name: string;
  description?: string;
}

export type ValueType = "string" | "number" | "boolean";

export interface OptionOptions {
  /** Default `"string"`. `"boolean"` makes it a flag (`--force`); `"number"` is parsed and validated. */
  type?: ValueType;
  description?: string;
  /** One-letter alias: `short: "f"` accepts `-f`. */
  short?: string;
  default?: string | number | boolean;
  required?: boolean;
  /** Accept the option several times (`--tag a --tag b`); the parameter receives an array. */
  multiple?: boolean;
}

export interface ArgumentOptions {
  description?: string;
  /** Default `"string"`. */
  type?: Exclude<ValueType, "boolean">;
  required?: boolean;
}

/** Where one parameter of `run()` gets its value from. */
export type ParamSource =
  | ({ kind: "option"; name: string } & OptionOptions)
  | ({ kind: "argument"; name: string } & ArgumentOptions);

const COMMAND = Symbol("blixis:command");
const PARAMS = Symbol("blixis:command-params");

const NAME = /^[a-z][a-z0-9]*(?:[:.-][a-z0-9]+)*$/;

/**
 * Marks a class as a command: `blix run <name>` boots your app (without listening), resolves the class
 * through DI, and calls its `run()` method. Also makes the class injectable, so you don't need
 * `@Injectable()` as well. Register it as a provider in a module like any other service.
 */
export function Command(options: CommandOptions): ClassDecorator {
  if (!NAME.test(options.name)) {
    throw new Error(`Invalid command name "${options.name}": use lower-case letters, digits and "-", ":" or "." between words (e.g. "seed" or "db:migrate").`);
  }
  return (target) => {
    Injectable()(target);
    defineMetadata(COMMAND, options, target);
  };
}

export function getCommandOptions(target: object): CommandOptions | undefined {
  return getMetadata(COMMAND, target);
}

function paramDecorator(source: ParamSource): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    if (propertyKey !== "run") {
      throw new Error("@Option and @Argument can only decorate parameters of a command's run() method.");
    }
    const sources = getMetadata<Map<number, ParamSource>>(PARAMS, target, propertyKey) ?? new Map<number, ParamSource>();
    sources.set(parameterIndex, source);
    defineMetadata(PARAMS, sources, target, propertyKey);
  };
}

/** A named option (`--count 5`, `--force`), passed to the decorated `run()` parameter. */
export function Option(name: string, options: OptionOptions = {}): ParameterDecorator {
  if (options.short !== undefined && !/^[A-Za-z]$/.test(options.short)) {
    throw new Error(`Option "${name}": short must be a single letter, got "${options.short}".`);
  }
  return paramDecorator({ kind: "option", name, ...options });
}

/** A positional argument, in the order its parameters are declared. */
export function Argument(name: string, options: ArgumentOptions = {}): ParameterDecorator {
  return paramDecorator({ kind: "argument", name, ...options });
}

export function getParamSources(prototype: object): Map<number, ParamSource> {
  return getMetadata(PARAMS, prototype, "run") ?? new Map();
}

/** The interface a command class implements. Parameters are filled from `@Option` / `@Argument`. */
export interface CommandRunner {
  /** Return a number to set the process exit code; anything else exits 0. */
  run(...args: never[]): number | void | Promise<number | void>;
}
