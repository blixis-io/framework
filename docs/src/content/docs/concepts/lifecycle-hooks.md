---
title: Lifecycle Hooks
description: OnModuleInit, OnApplicationBootstrap and OnApplicationShutdown, and why their ordering is guaranteed.
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

## `OnApplicationBootstrap`

Runs **once, after every provider has been created and every `onModuleInit` has finished**. Use it for *discovery*: scanning the application for providers that carry a decorator and wiring them up. `@OnEvent` handlers and `@Command` classes are found this way.

```ts
import type { BootstrapContext, OnApplicationBootstrap } from "@blixis-io/core";

@Injectable()
class HandlerRegistry implements OnApplicationBootstrap {
  onApplicationBootstrap(app: BootstrapContext): void {
    for (const [token, instance] of app.resolved()) {
      // look for your decorator's metadata on `instance`
    }
  }
}
```

`app.resolved()` lists every singleton provider instance with its token, in dependency order. Transient providers are never cached, so they don't appear. `app.get(token)` reaches any provider. The hook may be `async`, and a throw fails the boot, the same as `onModuleInit`. Because it runs after *all* `onModuleInit` hooks, unlike `onModuleInit` itself it can rely on every other provider being ready.

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

Calling `app.close()` more than once — once from a signal handler and once from a test's cleanup, say — is safe. The first call runs every shutdown hook and marks the application closed; every subsequent call returns that same promise, not a second run of every hook. With `createHttpApplication` that includes calls made while the first is still draining requests: they wait for the same drain.

```ts
process.on("SIGTERM", () => {
  void app.close("SIGTERM").then(() => process.exit(0));
});
```

## A shutdown hook that fails

`close()` runs **every** shutdown hook, even when one throws. Shutdown order is dependents first, so a failing hook early in the list (a metrics flush, say) must not stop the hooks after it, which is where the database pool gets closed. Failures are collected and rethrown once everything has run:

- one failure is rethrown as it is, so `catch (error)` sees what the hook threw;
- several are rethrown together as an [`AggregateError`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AggregateError), in the order the hooks ran, with the individual errors in `.errors`.

The application counts as closed either way, so calling `close()` again does not run the hooks a second time.

## When boot fails

If creating the application throws part-way (a provider's constructor, an `onModuleInit` or an `onApplicationBootstrap` fails), the providers that were already built may hold resources: a connection pool opened in a constructor, a timer, a file handle. `createApplication` closes them before it rejects: every provider that was constructed gets its `onApplicationShutdown` called, dependents first, **including the provider whose own `onModuleInit` threw**, and with no `signal` since nothing outside stopped it. A provider that was never constructed has nothing to close.

You still get the error that failed the boot, unchanged. If a shutdown hook also fails during this clean-up, that failure is written to `console.error` rather than replacing the boot error.

`createHttpApplication` and `createFetchHandler` follow the same rule for the step after that: if building the HTTP handler fails (a duplicate route, a class in `controllers` without `@Controller()`), the already-initialised providers are shut down before the error is thrown.

Two details that matter in practice:

- When one provider fails while others are still being built (an async factory, say), the clean-up waits for those to finish first, so nothing is left running unnoticed.
- This is what keeps a failed start from leaking. Without it, a pool left open by a failed boot kept the process alive for the pool's idle timeout, 10 seconds for `pg`, before it could exit; with it the process exits straight away. It also matters for [`createFetchHandler`](/framework/guides/deploying/), which tries to boot again on the next request: each failed attempt now cleans up after itself.

## Next

- How `app.close()` also has to tear down a listening socket, and stays idempotent there too: [Running in Production](/framework/guides/running-in-production/).
- The provider graph these hooks walk: [Modules](/framework/concepts/modules/).
