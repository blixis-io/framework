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
