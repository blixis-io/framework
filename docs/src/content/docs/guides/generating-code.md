---
title: Generating Code
description: Scaffold a controller, service, module, guard, or interceptor with blix, then wire it in by hand.
sidebar:
  order: 10
---

`blix` writes one file per call, from a template matching this framework's own conventions. It never edits anything else — wiring a generated file into your app is always a separate, explicit step. This walks through generating a real route end to end, the same way it happened in [hello-api](/examples/hello-api-walkthrough/).

## 1. Add the dependency

```json title="package.json"
{
  "devDependencies": {
    "@blixis/cli": "workspace:*"
  }
}
```

## 2. Generate

```bash
pnpm exec blix generate controller health
```

```
created src/health/health.controller.ts
```

```ts
import { Controller, Get } from "@blixis/http";

@Controller("health")
export class HealthController {
  @Get()
  list() {
    return [];
  }
}
```

## 3. Edit it into something real

The generated file is a valid starting point, not a finished route — edit it like any other file you wrote yourself:

```ts title="src/health/health.controller.ts" ins={5,6,7} del={4}
import { Controller, Get } from "@blixis/http";

@Controller("health")
export class HealthController {
  @Get()
  list() {
    return [];
  }
  check() {
    return { status: "ok" };
  }
}
```

## 4. Wire it in by hand

A single provider-less route doesn't need its own module — list it directly in `AppModule`'s `controllers`:

```ts title="src/app.module.ts" ins={2,6}
import { Module } from "@blixis/core";
import { HealthController } from "./health/health.controller.js";
// ...other imports

@Module({
  imports: [/* ... */],
  controllers: [HealthController],
})
export class AppModule {}
```

(For a route with real providers/guards behind it, generate a `module` too and import that instead — see [Modules](/concepts/modules/).)

## 5. Verify it

```bash
curl localhost:3000/health
# {"status":"ok"}
```

## Trying it dry first

Add `--dry-run` to any command to see the path and content without writing anything — useful for checking what a name normalizes to:

```bash
blix generate service PostTags --dry-run
```
```
Would create src/post-tags/post-tags.service.ts:

import { Injectable } from "@blixis/di";

@Injectable()
export class PostTagsService {}
```

## Next

- Every flag and template: [reference](/reference/blixis-cli/).
- Why nothing gets auto-wired: [Code Generation](/concepts/code-generation/#what-it-deliberately-doesnt-do).
