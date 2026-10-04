import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication, Module } from "@blixis-io/core";
import { RequestContext } from "@blixis-io/http";
import { describe, expect, it, vi } from "vitest";
import { Argument, Command } from "./decorators.js";
import { appLocation, blixCommand, bootApplication, DEFAULT_APP, loadRequestContextModule, runCommands } from "./plugin.js";

const notInstalled = () => Promise.reject(Object.assign(new Error("Cannot find package '@blixis-io/http' imported from x"), { code: "ERR_MODULE_NOT_FOUND" }));
const failing = () => Promise.reject(new Error("could not connect to the database"));
const fixtures = join(dirname(fileURLToPath(import.meta.url)), "test-fixtures");
const ctx = (args: string[], config?: Record<string, unknown>) => ({
  args,
  cwd: "/project",
  config: config ? { path: "/project/blix.config.ts", config } : undefined,
});

describe("appLocation", () => {
  it("defaults to dist/app.module.js and AppModule", () => {
    expect(appLocation(undefined)).toEqual(DEFAULT_APP);
    expect(appLocation({})).toEqual(DEFAULT_APP);
  });

  it("reads the app section, with each field optional", () => {
    expect(appLocation({ app: { module: "build/root.js", export: "Root" } })).toEqual({ module: "build/root.js", export: "Root" });
    expect(appLocation({ app: { module: "build/root.js" } })).toEqual({ module: "build/root.js", export: "AppModule" });
    expect(appLocation({ app: { export: "Root" } })).toEqual({ module: "dist/app.module.js", export: "Root" });
  });

  it("rejects a malformed section", () => {
    expect(() => appLocation({ app: "nope" })).toThrow('"app" must be an object');
    expect(() => appLocation({ app: null })).toThrow('"app" must be an object');
    expect(() => appLocation({ app: { module: 3 } })).toThrow("non-empty strings");
    expect(() => appLocation({ app: { export: "" } })).toThrow("non-empty strings");
  });
});

describe("bootApplication", () => {
  it("imports the module, boots it without listening, and exposes its providers", async () => {
    const app = await bootApplication(fixtures, { module: "app.mjs", export: "AppModule" });

    expect(app.resolved().map(([, instance]) => (typeof instance === "object" && instance !== null ? instance.constructor.name : ""))).toContain("HelloCommand");
    await app.close();
  });

  it("provides RequestContext, so guards and services that inject it still boot (and it reads empty outside a request)", async () => {
    const app = await bootApplication(fixtures, { module: "needs-context.mjs", export: "AppModule" });

    const injected = app.resolved().map(([, instance]) => instance).find((instance) => instance?.constructor.name === "NeedsContext");
    const context: unknown = typeof injected === "object" && injected !== null ? Reflect.get(injected, "context") : undefined;
    if (!(context instanceof RequestContext)) {
      throw new Error("NeedsContext did not receive a RequestContext");
    }
    expect(context.get("anything")).toBeUndefined();
    await app.close();
  });

  it("boots an app that doesn't need RequestContext when http can't be loaded", async () => {
    const app = await bootApplication(fixtures, { module: "app.mjs", export: "AppModule" }, notInstalled);
    await app.close();

    // And one that does need it keeps the plain "No provider" error, which names what is missing.
    await expect(bootApplication(fixtures, { module: "needs-context.mjs", export: "AppModule" }, notInstalled)).rejects.toThrow('No provider for "RequestContext"');
  });

  it("explains how to fix a module that can't be loaded", async () => {
    await expect(bootApplication(fixtures, { module: "missing.mjs", export: "AppModule" })).rejects.toThrow(
      /Could not load missing\.mjs: .*\nBuild your app first/s,
    );
  });

  it("names the missing export", async () => {
    await expect(bootApplication(fixtures, { module: "app.mjs", export: "Nope" })).rejects.toThrow('has no export named "Nope"');
  });

  it("rejects an export that isn't a class", async () => {
    await expect(bootApplication(fixtures, { module: "app.mjs", export: "NotAModule" })).rejects.toThrow('has no export named "NotAModule"');
  });
});

describe("loadRequestContextModule", () => {
  it("returns the module http exports", async () => {
    class RequestContextModule {}
    expect(await loadRequestContextModule(() => Promise.resolve({ RequestContextModule }))).toBe(RequestContextModule);
  });

  it("returns nothing when http is not installed, or is too old to export it", async () => {
    const missing = Object.assign(new Error("Cannot find package '@blixis-io/http' imported from /app"), { code: "ERR_MODULE_NOT_FOUND" });
    expect(await loadRequestContextModule(() => Promise.reject(missing))).toBeUndefined();
    expect(await loadRequestContextModule(() => Promise.resolve({}))).toBeUndefined();
    expect(await loadRequestContextModule(() => Promise.resolve(undefined))).toBeUndefined();
  });

  it("does not swallow other failures, such as a broken http install or a different missing package", async () => {
    const other = Object.assign(new Error("Cannot find package 'left-pad' imported from /app"), { code: "ERR_MODULE_NOT_FOUND" });
    await expect(loadRequestContextModule(() => Promise.reject(other))).rejects.toThrow("left-pad");
    await expect(loadRequestContextModule(() => Promise.reject(new Error("SyntaxError in http")))).rejects.toThrow("SyntaxError in http");
  });
});

/** A real container, wrapped so tests can see whether close() ran and with what. */
async function fakeBoot(providers: (new () => object)[]) {
  @Module({ providers })
  class AppModule {}
  const app = await createApplication(AppModule);
  const close = vi.fn<(signal?: string) => Promise<void>>().mockResolvedValue();
  return { boot: () => Promise.resolve({ resolved: () => app.resolved(), close }), close };
}

@Command({ name: "hello", description: "Says hello" })
class Hello {
  static ran: string[] = [];
  run(@Argument("who") who: string | undefined): void {
    Hello.ran.push(who ?? "nobody");
  }
}

@Command({ name: "explode" })
class Explode {
  run(): void {
    throw new Error("kaboom");
  }
}

describe("runCommands", () => {
  it("lists the commands when given no name", async () => {
    const { boot } = await fakeBoot([Hello]);

    const result = await runCommands(ctx([]), { boot });

    expect(result).toEqual({
      exitCode: 0,
      stdout: "Commands:\n  hello  Says hello\n\nRun `blix run <command> --help` for a command's options.\n",
      stderr: "",
    });
  });

  it("runs the named command with the rest of the arguments, then closes the app", async () => {
    Hello.ran = [];
    const { boot, close } = await fakeBoot([Hello]);

    const result = await runCommands(ctx(["hello", "world"]), { boot });

    expect(result.exitCode).toBe(0);
    expect(Hello.ran).toEqual(["world"]);
    expect(close).toHaveBeenCalledWith("command");
  });

  it("closes the app even when the command fails", async () => {
    const { boot, close } = await fakeBoot([Explode]);

    const result = await runCommands(ctx(["explode"]), { boot });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("explode failed: kaboom\n");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("an unknown command lists the real ones and exits 1", async () => {
    const { boot, close } = await fakeBoot([Hello]);

    const result = await runCommands(ctx(["nope"]), { boot });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown command "nope".');
    expect(result.stderr).toContain("hello  Says hello");
    expect(close).toHaveBeenCalled();
  });

  it("shows this tool's usage for --help, without booting anything", async () => {
    const boot = vi.fn<() => Promise<never>>();

    const result = await runCommands(ctx(["--help"]), { boot });

    expect(result.stdout).toContain("blix run <command> --help");
    expect(boot).not.toHaveBeenCalled();
  });

  it("passes --help after a command name through to that command", async () => {
    const { boot } = await fakeBoot([Hello]);

    expect((await runCommands(ctx(["hello", "--help"]), { boot })).stdout).toContain("Usage: blix run hello");
  });

  it("reports a boot failure, and a bad app config, as a clean error", async () => {
    expect(await runCommands(ctx([]), { boot: failing })).toEqual({ exitCode: 1, stdout: "", stderr: "could not connect to the database\n" });
    expect((await runCommands(ctx([], { app: "x" }), { boot: failing })).stderr).toContain('"app" must be an object');
  });

  it("reports two commands with one name, and still closes the app", async () => {
    @Command({ name: "twin" })
    class TwinA {
      run(): void {}
    }
    @Command({ name: "twin" })
    class TwinB {
      run(): void {}
    }
    const { boot, close } = await fakeBoot([TwinA, TwinB]);

    const result = await runCommands(ctx([]), { boot });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Two commands are named "twin"');
    expect(close).toHaveBeenCalled();
  });

  it("is what blix loads as `run`", () => {
    expect(blixCommand.name).toBe("run");
    expect(blixCommand.description).toContain("@Command");
  });

  it("blixCommand.run uses the real loader with the project's app config", async () => {
    const result = await blixCommand.run({ args: [], cwd: fixtures, config: { path: join(fixtures, "blix.config.ts"), config: { app: { module: "app.mjs" } } } });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello  Says hello");
  });
});
