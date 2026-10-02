import { createApplication, Module } from "@blixis-io/core";
import { Inject, Injectable, InjectionToken } from "@blixis-io/di";
import { describe, expect, it } from "vitest";
import { Argument, Command, getCommandOptions, getParamSources, Option } from "./decorators.js";
import { discoverCommands, helpFor, listCommands, runCommand } from "./run.js";

const calls: unknown[][] = [];

@Command({ name: "seed", description: "Seed the database" })
class SeedCommand {
  run(
    @Option("count", { type: "number", default: 10, description: "how many rows", short: "c" }) count: number,
    @Option("force", { type: "boolean", description: "overwrite", short: "f" }) force: boolean,
    @Option("tag", { multiple: true }) tags: string[] | undefined,
    @Argument("table", { required: true, description: "target table" }) table: string,
    @Argument("limit", { type: "number" }) limit: number | undefined,
  ): number {
    calls.push([count, force, tags, table, limit]);
    return 0;
  }
}

async function commandsOf(...classes: (new (...args: never[]) => object)[]) {
  @Module({ providers: classes })
  class AppModule {}
  const app = await createApplication(AppModule);
  return discoverCommands(app.resolved());
}

async function seed() {
  const [command] = await commandsOf(SeedCommand);
  if (!command) {
    throw new Error("no command");
  }
  return command;
}

describe("@Command", () => {
  it("records the options and makes the class injectable by itself", async () => {
    expect(getCommandOptions(SeedCommand)).toEqual({ name: "seed", description: "Seed the database" });
    // No @Injectable() on SeedCommand: @Command supplies it, so the container can build it.
    expect((await commandsOf(SeedCommand)).map((command) => command.options.name)).toEqual(["seed"]);
  });

  it.each(["db:migrate", "seed", "cache.clear", "a-b"])("accepts the name %s", (name) => {
    expect(() => Command({ name })).not.toThrow();
  });

  it.each(["", "Seed", "1seed", "seed ", "a b", "-x", "a::b"])("rejects the name %j", (name) => {
    expect(() => Command({ name })).toThrow("Invalid command name");
  });

  it("gives the command DI like any provider", async () => {
    const GREETING = new InjectionToken<string>("greeting");
    const seen: string[] = [];

    @Command({ name: "greet" })
    class GreetCommand {
      constructor(@Inject(GREETING) private readonly greeting: string) {}
      run(@Argument("who") who: string): void {
        seen.push(`${this.greeting}, ${who}`);
      }
    }

    @Module({ providers: [{ provide: GREETING, useValue: "hello" }, GreetCommand] })
    class AppModule {}
    const [command] = discoverCommands((await createApplication(AppModule)).resolved());

    await runCommand(command!, ["world"]);

    expect(seen).toEqual(["hello, world"]);
  });

  it("rejects @Option/@Argument anywhere but run()", () => {
    expect(() => {
      class Wrong {
        notRun(@Option("x") _x: string): void {}
      }
      return Wrong;
    }).toThrow("only decorate parameters of a command's run() method");
  });

  it("rejects an invalid short flag", () => {
    expect(() => Option("x", { short: "xy" })).toThrow('short must be a single letter, got "xy"');
  });

  it("records parameter sources by index", () => {
    const sources = getParamSources(SeedCommand.prototype);

    expect([...sources.keys()]).toEqual([4, 3, 2, 1, 0]);
    expect(sources.get(0)).toMatchObject({ kind: "option", name: "count", type: "number", default: 10 });
    expect(sources.get(3)).toMatchObject({ kind: "argument", name: "table", required: true });
  });
});

describe("runCommand: values", () => {
  it("passes defaults, booleans, arguments and absent optionals", async () => {
    calls.length = 0;

    const result = await runCommand(await seed(), ["users"]);

    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([[10, false, undefined, "users", undefined]]);
  });

  it("parses numbers, flags, repeated options and several arguments", async () => {
    calls.length = 0;

    await runCommand(await seed(), ["--count", "3", "-f", "--tag", "a", "--tag", "b", "users", "25"]);

    expect(calls).toEqual([[3, true, ["a", "b"], "users", 25]]);
  });

  it("accepts --option=value and short aliases", async () => {
    calls.length = 0;

    await runCommand(await seed(), ["--count=7", "users"]);
    await runCommand(await seed(), ["-c", "8", "users"]);

    expect(calls.map((call) => call[0])).toEqual([7, 8]);
  });

  it("uses the command's return value as the exit code", async () => {
    @Command({ name: "exits" })
    class Exits {
      run(): number {
        return 3;
      }
    }
    const [command] = await commandsOf(Exits);

    expect((await runCommand(command!, [])).exitCode).toBe(3);
  });

  it("awaits an async run()", async () => {
    @Command({ name: "slow" })
    class Slow {
      static done = false;
      async run(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 10));
        Slow.done = true;
      }
    }
    const [command] = await commandsOf(Slow);

    expect((await runCommand(command!, [])).exitCode).toBe(0);
    expect(Slow.done).toBe(true);
  });
});

describe("runCommand: usage errors", () => {
  it("rejects a non-numeric number, naming the option", async () => {
    const result = await runCommand(await seed(), ["--count", "many", "users"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('--count must be a number, got "many".\n');
  });

  it("rejects an empty string as a number", async () => {
    expect((await runCommand(await seed(), ["--count", "", "users"])).stderr).toContain("must be a number");
  });

  it("rejects a non-numeric positional number", async () => {
    expect((await runCommand(await seed(), ["users", "abc"])).stderr).toBe('<limit> must be a number, got "abc".\n');
  });

  it("reports a missing required argument and points at --help", async () => {
    const result = await runCommand(await seed(), []);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing required argument <table>.");
    expect(result.stderr).toContain("blix run seed --help");
  });

  it("reports a missing required option", async () => {
    @Command({ name: "needs" })
    class Needs {
      run(@Option("token", { required: true }) _token: string): void {}
    }
    const [command] = await commandsOf(Needs);

    expect((await runCommand(command!, [])).stderr).toContain("Missing required option --token.");
  });

  it("a default satisfies required", async () => {
    @Command({ name: "defaulted" })
    class Defaulted {
      run(@Option("mode", { required: true, default: "fast" }) _mode: string): void {}
    }
    const [command] = await commandsOf(Defaulted);

    expect((await runCommand(command!, [])).exitCode).toBe(0);
  });

  it("rejects an unknown option and an extra positional", async () => {
    expect((await runCommand(await seed(), ["--nope", "users"])).stderr).toContain("Unknown option '--nope'");
    expect((await runCommand(await seed(), ["users", "1", "extra"])).stderr).toContain('Unexpected argument "extra"');
  });

  it("an error thrown by run() becomes a clean failure naming the command", async () => {
    @Command({ name: "boom" })
    class Boom {
      run(): void {
        throw new Error("disk full");
      }
    }
    const [command] = await commandsOf(Boom);

    const result = await runCommand(command!, []);

    expect(result).toEqual({ exitCode: 1, stdout: "", stderr: "boom failed: disk full\n" });
  });

  it("reports a @Command class that has no run()", async () => {
    @Command({ name: "norun" })
    class NoRun {}
    const [command] = await commandsOf(NoRun);

    expect((await runCommand(command!, [])).stderr).toBe("NoRun is marked @Command but has no run() method.\n");
  });
});

describe("help and listing", () => {
  it("--help prints generated usage and does not run the command", async () => {
    calls.length = 0;

    const result = await runCommand(await seed(), ["--help"]);

    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([]);
    expect(result.stdout).toBe(`seed - Seed the database

Usage: blix run seed [options] <table> [limit]

Arguments:
  table           target table (required)
  limit

Options:
  -c, --count <number>      how many rows (default: 10)
  -f, --force               overwrite
      --tag <string>
  -h, --help                Show this help
`);
  });

  it("-h works too, and a command with no params has a minimal help", async () => {
    @Command({ name: "plain", description: "Does a thing" })
    class Plain {
      run(): void {}
    }
    const [command] = await commandsOf(Plain);

    expect(helpFor(command!)).toBe("plain - Does a thing\n\nUsage: blix run plain\n\nOptions:\n  -h, --help                Show this help\n");
    expect((await runCommand(command!, ["-h"])).stdout).toContain("Usage: blix run plain");
  });

  it("lists commands sorted, aligned, with descriptions", async () => {
    @Command({ name: "zeta", description: "Last" })
    class Zeta {
      run(): void {}
    }
    @Command({ name: "db:migrate" })
    class Migrate {
      run(): void {}
    }

    const text = listCommands(await commandsOf(Zeta, Migrate, SeedCommand));

    expect(text).toBe("Commands:\n  db:migrate\n  seed        Seed the database\n  zeta        Last\n\nRun `blix run <command> --help` for a command's options.\n");
  });

  it("says what to do when there are no commands", () => {
    expect(listCommands([])).toContain("Decorate a class with @Command");
  });
});

describe("discoverCommands", () => {
  it("ignores providers without @Command and non-object instances", async () => {
    @Injectable()
    class Plain {}

    @Module({ providers: [Plain, SeedCommand, { provide: new InjectionToken<string>("s"), useValue: "text" }] })
    class AppModule {}

    expect(discoverCommands((await createApplication(AppModule)).resolved()).map((command) => command.options.name)).toEqual(["seed"]);
  });

  it("refuses two commands with the same name", async () => {
    @Command({ name: "dup" })
    class A {
      run(): void {}
    }
    @Command({ name: "dup" })
    class B {
      run(): void {}
    }

    @Module({ providers: [A, B] })
    class AppModule {}
    const app = await createApplication(AppModule);

    expect(() => discoverCommands(app.resolved())).toThrow('Two commands are named "dup": A and B.');
  });
});
