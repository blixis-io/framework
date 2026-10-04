---
title: "@blixis-io/commands"
description: Reference for @Command, @Option, @Argument and blix run.
sidebar:
  order: 14
---

Command-line tasks written as injectable classes. See [Writing Commands](/framework/guides/writing-commands/) for the walkthrough. `@blixis-io/core`, `@blixis-io/di` and `@blixis-io/cli` are peer dependencies, so there is a single copy of each.

## Decorators

```ts
function Command(options: CommandOptions): ClassDecorator;
function Option(name: string, options?: OptionOptions): ParameterDecorator;
function Argument(name: string, options?: ArgumentOptions): ParameterDecorator;

interface CommandOptions {
  name: string; // "seed", "db:migrate", "cache.clear"
  description?: string;
}

interface OptionOptions {
  type?: "string" | "number" | "boolean"; // default "string"
  description?: string;
  short?: string; // one letter
  default?: string | number | boolean;
  required?: boolean;
  multiple?: boolean; // the parameter receives an array
}

interface ArgumentOptions {
  type?: "string" | "number";
  description?: string;
  required?: boolean;
}
```

`@Command` also applies `@Injectable()`. `@Option` and `@Argument` can only decorate parameters of a method named `run`; anywhere else they throw at class-definition time. An invalid command name or a multi-letter `short` throws immediately too.

A command class implements `CommandRunner`: a `run(...)` method whose parameters are filled from the decorators. Return a number for the exit code; anything else exits `0`.

## `blix run`

```
blix run                  list the commands in your app
blix run <command> [...]  run one
blix run <command> --help show its usage
```

| Step | |
|---|---|
| Load | Imports the compiled module from `app.module` in `blix.config` (default `dist/app.module.js`) and its `app.export` (default `AppModule`) |
| Boot | `createApplication`, with no HTTP server, plus `RequestContext` when `@blixis-io/http` is installed (empty outside a request). `OnModuleInit` and `OnApplicationBootstrap` hooks run |
| Discover | Every resolved singleton provider with `@Command` metadata |
| Run | Parses the arguments, calls `run()` |
| Close | `app.close("command")`, always, so `OnApplicationShutdown` hooks run even when the command failed |

## Programmatic API

```ts
import { discoverCommands, runCommand, listCommands, helpFor, runCommands, appLocation } from "@blixis-io/commands";

const commands = discoverCommands(app.resolved()); // RegisteredCommand[], sorted by name
const result = await runCommand(commands[0]!, ["--times", "3", "world"]); // { exitCode, stdout, stderr }
```

`runCommands(context, deps?)` is the whole `blix run` flow, and `deps.boot` replaces how the application is created, which is how the tests run it without a build. `blixCommand` is what `blix` loads.
