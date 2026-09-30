---
title: Lifecycle Hooks
description: OnModuleInit and OnApplicationShutdown, and why their ordering is guaranteed.
sidebar:
  order: 4
---

Any provider can hook into application startup and shutdown by implementing one or both of two interfaces from `@blixis-io/core`. No registration step — the interface, structurally satisfied, is all it takes.

## `OnModuleInit`

```ts
import type { OnModuleInit } from "@blixis-io/core";
import { Injectable } from "@blixis-io/di";

@Injectable()
class DatabaseConnection implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    await this.connect();
  }
}
```

`createApplication` calls `onModuleInit()` on every provider that has it, **after all providers are constructed**, in **dependency order** — a provider's own dependencies always finish their `onModuleInit()` before it runs its own. This is why the hook exists separately from the constructor: the constructor can only assume its *own* dependencies exist, not that they've finished any async setup they need.

## `OnApplicationShutdown`

```ts
import type { OnApplicationShutdown } from "@blixis-io/core";

@Injectable()
class DatabaseConnection implements OnApplicationShutdown {
  async onApplicationShutdown(signal?: string): Promise<void> {
    await this.disconnect();
  }
}
```

Called from `app.close(signal?)`, in **reverse** dependency order — a provider's dependents shut down before it does, so nothing loses a dependency it still needs mid-shutdown. `signal` is whatever string you pass to `close()` (typically the process signal name, e.g. `"SIGTERM"`), or `undefined` if you don't pass one.

## Why the ordering is guaranteed, not incidental

The container tracks the order providers actually finish constructing — which, because a provider's dependencies are always awaited before it's instantiated, is already exactly dependency order. Startup replays that order forward; shutdown replays it backward. You don't declare priorities or ordering hints anywhere; it falls out of the dependency graph itself.

## `close()` is idempotent

Calling `app.close()` more than once — once from a signal handler and once from a test's cleanup, say — is safe. The first call runs every shutdown hook and marks the application closed; every subsequent call is a no-op, not a second run of every hook.

```ts
process.on("SIGTERM", () => {
  void app.close("SIGTERM").then(() => process.exit(0));
});
```

## Next

- How `app.close()` also has to tear down a listening socket, and stays idempotent there too: [Running in Production](/framework/guides/running-in-production/).
- The provider graph these hooks walk: [Modules](/framework/concepts/modules/).
