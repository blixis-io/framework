---
title: "@blixis-io/cli"
description: Full reference for the blix command-line tool.
sidebar:
  order: 11
---

The `blix` binary. See [Code Generation](/framework/concepts/code-generation/) for the concepts.

## `blix generate` (`blix g`)

```
blix generate <type> <name> [--flat] [--force] [--dry-run]
blix g <type> <name> [--flat] [--force] [--dry-run]
```

| Argument | |
|---|---|
| `<type>` | `controller` (`c`), `service` (`s`), `module` (`m`), `guard` (`g`), `interceptor` (`i`) |
| `<name>` | Any casing — normalized to kebab-case (path) and PascalCase (class name) |

| Flag | |
|---|---|
| `--flat` | Write `src/<name>.<type>.ts` instead of `src/<name>/<name>.<type>.ts` |
| `--force` | Overwrite an existing file (default: refuse, exit `1`) |
| `--dry-run` | Print the resolved path and rendered content; write nothing |

Exits `0` on success, `1` on any error (missing arguments, an unknown type, or an existing file without `--force`) — safe to use in a script.

## `blix add <plugin>`

```
blix add deploy
```

Installs a plugin package as a dev dependency, using the package manager that owns the project (judged by the nearest lockfile at or above the current directory: `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`/`bun.lockb`, `package-lock.json`; npm if there is none). Exits `1` for an unknown plugin or a failed install.

## Plugin commands

Some commands live in their own package so the CLI itself stays dependency-free. `blix deploy` is provided by `@blixis-io/deploy` (see [Deploying](/framework/guides/deploying/)). The CLI finds it in **your project's** `node_modules` (resolved from the current directory, so a workspace package finds the root's install). If it isn't installed, `blix deploy` exits `1` and says to run `blix add deploy`. `blix --help` lists the known plugin commands.

A plugin package exports a `blixCommand`:

```ts
import type { BlixCommand } from "@blixis-io/cli";

export const blixCommand: BlixCommand = {
  name: "deploy",
  description: "build and deploy",
  run({ args, cwd, config }) {
    return { exitCode: 0, stdout: "deployed\n", stderr: "" };
  },
};
```

`run` receives everything after the command name (`args`), the working directory, and the loaded `blix.config.*` (or `undefined`). It returns `{ exitCode, stdout, stderr }`; a thrown error becomes `blix <command> failed: <message>` with exit `1`.

## `blix.config.ts`

Plugins read their settings from a `blix.config.*` file in the project root: `blix.config.ts`, `.mts`, `.js`, `.mjs` or `.json`, first match wins. TypeScript works with no extra tooling because Node 24 strips types natively.

```ts title="blix.config.ts"
import { defineConfig } from "@blixis-io/cli";

export default defineConfig({
  deploy: { /* owned and validated by @blixis-io/deploy */ },
});
```

The file must default-export an object; each plugin owns one top-level section. A config that exists but can't be loaded exits `1` with `Could not load blix.config.ts: ...` for plugin commands. Built-in commands such as `generate` never read it, so a broken config can't block them.

## `blix --version`

Prints the installed version (`-v` works too).

## Programmatic use

```ts
import { runCli } from "@blixis-io/cli";

const { exitCode, stdout, stderr } = await runCli(["generate", "controller", "posts"], process.cwd());
```

`runCli` is **async** since 0.2.0 (plugin commands need it), and takes an optional third argument `{ install }` to replace the package-manager runner, which is how the tests avoid touching the network. `defineConfig`, `loadConfig`, `detectPackageManager` and the `BlixCommand`/`CommandContext`/`BlixConfig` types are exported too.

## Templates, one example each

```bash
blix g controller posts   # src/posts/posts.controller.ts
```
```ts
import { Controller, Get } from "@blixis-io/http";

@Controller("posts")
export class PostsController {
  @Get()
  list() {
    return [];
  }
}
```

```bash
blix g service posts      # src/posts/posts.service.ts
```
```ts
import { Injectable } from "@blixis-io/di";

@Injectable()
export class PostsService {}
```

```bash
blix g module posts       # src/posts/posts.module.ts
```
```ts
import { Module } from "@blixis-io/core";

@Module({})
export class PostsModule {}
```

```bash
blix g guard posts        # src/posts/posts.guard.ts
```
```ts
import { Injectable } from "@blixis-io/di";
import type { CanActivate, ExecutionContext } from "@blixis-io/http";

@Injectable()
export class PostsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return true;
  }
}
```

```bash
blix g interceptor posts  # src/posts/posts.interceptor.ts
```
```ts
import { Injectable } from "@blixis-io/di";
import type { ExecutionContext, Interceptor } from "@blixis-io/http";

@Injectable()
export class PostsInterceptor implements Interceptor {
  async intercept(context: ExecutionContext, next: () => Promise<Response>): Promise<Response> {
    return next();
  }
}
```

## Installing it

```json title="package.json"
{
  "devDependencies": {
    "@blixis-io/cli": "workspace:*"
  }
}
```

Then `pnpm exec blix generate ...` (or add `node_modules/.bin` to your `PATH`, or run any package script that shells out to `blix`) from the project you want files written into — paths always resolve relative to the current working directory.
