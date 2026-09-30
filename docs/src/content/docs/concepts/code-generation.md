---
title: Code Generation
description: "blix generate — scaffold a controller, service, module, guard, or interceptor from a template."
sidebar:
  order: 17
---

`@blixis-io/cli` ships one binary, `blix`, with one command: `generate` (`g` for short). It writes one file from a template — a controller, service, module, guard, or interceptor — matching the exact shape this framework's own examples already use. Nothing else: no whole-project scaffolding (`blix new` doesn't exist), no cross-file wiring.

## Usage

```bash
blix generate <type> <name> [--flat] [--force] [--dry-run]
```

`<type>` is `controller`, `service`, `module`, `guard`, or `interceptor` — or its first letter (`c`, `s`, `m`, `g`, `i`). `<name>` accepts any casing (`posts`, `post-tags`, `PostTags`) — it's normalized to kebab-case for the file path and PascalCase for the class name, so all three produce the same output.

```bash
blix generate controller posts
# created src/posts/posts.controller.ts
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

## Where files land

By default, every generator nests into a per-resource folder: `src/<name>/<name>.<type>.ts` — running `blix g controller posts` then `blix g service posts` puts both in `src/posts/`, matching how every real example in this framework's own docs is laid out (see the [hello-api walkthrough](/examples/hello-api-walkthrough/)). Pass `--flat` to skip the subfolder: `src/<name>.<type>.ts`.

## Safety

Refuses to overwrite an existing file — you'll get a clear error, nothing is touched. Pass `--force` if you actually mean to replace it. `--dry-run` prints the resolved path and the exact content that would be written, without writing anything — useful for checking what a name normalizes to before committing to it.

## What it deliberately doesn't do

A generated file is a valid, self-contained starting point — it compiles, and for a controller it's a real (if minimal) route — but nothing gets wired into anything else automatically. A generated controller is never added to an existing module's `controllers` array; a generated module is never imported into `AppModule`. That's a conscious boundary, not a missing feature: editing an existing file to wire something in is exactly the kind of thing worth doing by hand, where you can see (and mean) the change — see the [hello-api walkthrough](/examples/hello-api-walkthrough/#healthhealthcontrollerts) for a real example of generating a controller and then hand-editing and wiring it in.

## Next

- Every flag and type, with one example each: [reference](/reference/blixis-cli/).
- Step-by-step, including a real generate-then-wire-in example: [guide](/guides/generating-code/).
