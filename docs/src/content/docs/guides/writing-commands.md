---
title: Writing Commands
description: Command-line tasks as injectable classes, run with blix run.
sidebar:
  order: 13
---

A command is a class with a `run()` method. It gets the same dependency injection as the rest of your app, so a seed script or a migration can use your real services instead of reinventing their setup.

```bash
blix add run          # installs @blixis-io/commands
```

## A command

```ts title="src/greet.command.ts"
import { Argument, Command, Option } from "@blixis-io/commands";
import { HelloService } from "./hello.service.js";

@Command({ name: "greet", description: "Greet someone" })
export class GreetCommand {
  constructor(private readonly hello: HelloService) {}

  run(
    @Argument("name", { required: true, description: "who to greet" }) name: string,
    @Option("times", { type: "number", default: 1, short: "t" }) times: number,
    @Option("shout", { type: "boolean" }) shout: boolean,
  ): number {
    for (let i = 0; i < times; i++) {
      const line = this.hello.greet(name);
      console.log(shout ? line.toUpperCase() : line);
    }
    return 0;
  }
}
```

Add it to a module's `providers`, like any service. `@Command` makes the class injectable by itself, so `@Injectable()` is not needed.

```ts
@Module({ providers: [HelloService, GreetCommand] })
export class AppModule {}
```

## Running it

Build your app (commands run from compiled JavaScript, like everything in Blixis), then:

```bash
blix run                          # lists the commands in your app
blix run greet --help             # usage generated from the decorators
blix run greet world -t 2 --shout
```

```
$ blix run greet --help
greet - Greet someone

Usage: blix run greet [options] <name>

Arguments:
  name            who to greet (required)

Options:
  -t, --times <number>      how many times (default: 1)
      --shout
  -h, --help                Show this help
```

What `blix run` does: it imports your compiled app module, boots the module graph **without listening on a socket**, resolves the command through DI, runs it, and then closes the app, so `onApplicationShutdown` hooks run (a database pool gets closed, for instance). The command's `OnModuleInit` hooks run first, as they would when the app starts.

## Where it finds your app

By default, `dist/app.module.js` and its `AppModule` export. Change that in `blix.config.ts`:

```ts title="blix.config.ts"
import { defineConfig } from "@blixis-io/cli";

export default defineConfig({
  app: { module: "build/root.js", export: "RootModule" },
});
```

## Options and arguments

`@Option(name, options)` and `@Argument(name, options)` decorate parameters of `run()`:

| Option | |
|---|---|
| `type` | `"string"` (default), `"number"` (parsed and validated) or `"boolean"` (a flag, option only) |
| `description` | Shown in `--help` |
| `short` | One-letter alias (`-t`), option only |
| `default` | Used when the option is absent. A default also satisfies `required`. Option only |
| `required` | Fails with `Missing required option --name` / `argument <name>` |
| `multiple` | Option only: `--tag a --tag b` gives `["a", "b"]` |

Arguments are positional, in the order their parameters are declared. `--name value` and `--name=value` both work. Parsing uses Node's own `parseArgs` in strict mode, so an unknown option is an error rather than silently ignored.

## Exit codes and errors

`run()` may return a number to set the exit code; anything else exits `0`. A usage error (a missing argument, a non-numeric `--times`, an unknown option) prints a message and exits `1`. If `run()` throws, you get `<command> failed: <message>` and exit `1`, and the app is still closed. Two commands with the same name are reported as an error rather than one silently winning.

Command names are lower-case letters and digits, with `-`, `:` or `.` between words, so `db:migrate` and `cache.clear` are fine.

## Shipping commands in a module

A command is just a provider, so any module can bring its own. A library can export a module whose providers include `@Command` classes, and `blix run` finds them in the same listing.

## `RequestContext` in a command

An app with HTTP guards or services that inject `RequestContext` still boots under `blix run`: when `@blixis-io/http` is installed, `blix run` provides `RequestContext` the way `createHttpApplication` does. There is no request, so it reads empty (`get` returns `undefined`, `has` returns `false`) and `set` throws, as described under [Request Context](/framework/concepts/request-context/#gethas-vs-set-outside-a-request). Code that falls back when nothing is set, like `PostsService.remove()` in [hello-api](/framework/examples/hello-api-walkthrough/), works unchanged.

`@blixis-io/http` is an optional peer dependency of `@blixis-io/commands`, resolved like `@blixis-io/core` and `@blixis-io/di` so `blix run` and your app share one copy. An app without `@blixis-io/http` is booted as before. Because every provider is created at boot, an app that injects `RequestContext` but has no `@blixis-io/http` fails with `No provider for "RequestContext"` before any command runs.
