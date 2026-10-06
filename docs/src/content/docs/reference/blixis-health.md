---
title: "@blixis-io/health"
description: Full API reference for the health package.
sidebar:
  order: 18
---

Liveness and readiness endpoints for `@blixis-io/http`. See [Health checks](/framework/guides/health-checks/) for how to use it. Peer dependencies: `@blixis-io/core`, `@blixis-io/di`, `@blixis-io/http`.

## `defineHealthModule`

```ts
function defineHealthModule(options?: HealthOptions): {
  health: Health;
  HEALTH: InjectionToken<Health>; // inject it to register a check
  HealthModule: { forRoot(options?: { global?: boolean }): DynamicModule }; // global by default
};
```

Same factory shape as `defineConfigModule` and friends. `createHealth(options?)` gives just the `Health` object, without the module.

## `Health`

```ts
interface Health {
  readonly middleware: Middleware; // GET/HEAD on livePath and readyPath; everything else goes on
  check(name: string, check: HealthCheck): () => void; // register; returns a remover; the same name replaces
  watch(app: Drainable): void; // readiness reports "draining" while app.draining is true
  ready(): Promise<ReadinessReport>; // what /readyz answers, as data
}

type HealthCheck = () => void | Promise<void>; // throw or reject = unhealthy

interface Drainable {
  readonly draining: boolean; // an HttpApplication satisfies it
}
```

## `HealthOptions`

```ts
interface HealthOptions {
  livePath?: string; // default "/livez"
  readyPath?: string; // default "/readyz"; the same as livePath throws RangeError
  checkTimeoutMs?: number; // per check, default 2000
  onCheckFailed?: (name: string, error: unknown) => void; // every failing check on every probe
}
```

Without `onCheckFailed`, a check that starts failing is written once with `console.error`. A hook that throws is caught.

## `ReadinessReport`

```ts
interface ReadinessReport {
  status: "ok" | "fail" | "draining";
  checks: Record<string, { status: "ok" | "fail"; durationMs: number }>;
}
```

`/readyz` answers this as JSON: `200` for `"ok"`, `503` otherwise. The error of a failing check is never in it. `/livez` answers `200 {"status":"ok"}` without running any check. Both send `Cache-Control: no-store`; `HEAD` gets the status without a body.
