---
title: Configuration
description: Zod-validated environment config, fails fast at boot.
sidebar:
  order: 11
---

`@blixis-io/config` turns `process.env` into a typed, validated object — reusing the exact same `DynamicModule`/`forRoot()` pattern [Modules](/framework/concepts/modules/#dynamic-modules-the-forroot-pattern) already introduced for runtime configuration.

## Why it's a factory, not a fixed token

[`@blixis-io/logging`](/framework/concepts/logging/) exports one `LOGGER` token because every app's `Logger` has the same shape. Config doesn't work that way — every app has its own env variables. So instead of a token, the package exports a **function** that builds one:

```ts
import { defineConfigModule } from "@blixis-io/config";
import { z } from "zod";

const AppConfigSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string(),
});

export const { CONFIG, ConfigModule } = defineConfigModule(AppConfigSchema);
```

`CONFIG` here is a brand-new `InjectionToken<{ PORT: number; DATABASE_URL: string }>`, typed exactly to your schema — call `defineConfigModule` once, export the result, and import `CONFIG`/`ConfigModule` from that one file everywhere else in the app.

## Fails at boot, not at first use

```ts
@Module({ imports: [ConfigModule.forRoot()] })
class AppModule {}
```

`forRoot()` validates `source` (default: `process.env`) **synchronously, the moment it's called** — which is while the module graph is still being declared, before `createApplication()` resolves a single provider. A missing `DATABASE_URL` throws a `ConfigValidationError` immediately:

```
Invalid configuration:
  - DATABASE_URL: Required
```

This is deliberately as early as it can possibly fail — not a factory provider resolved lazily later, not a runtime error the first time some service happens to read the value. A broken environment crashes on startup, loud and immediate, not three requests into production.

## Coercion and defaults are just Zod

```ts
const AppConfigSchema = z.object({
  PORT: z.coerce.number().default(3000), // env vars are always strings
  DEBUG: z.coerce.boolean().default(false),
});
```

Every env var arrives as `string | undefined` — `z.coerce.number()`/`z.coerce.boolean()` convert it, `.default(...)` fills in what's missing, exactly like [validating a request body](/framework/concepts/request-validation/) with the same library.

## Testing with a different source

```ts
ConfigModule.forRoot({ PORT: "4000", DATABASE_URL: "postgres://test" });
```

Since `forRoot()` takes `source` as a plain argument, a test can pass its own object directly instead of mutating `process.env` or reaching for `@blixis-io/testing`'s `.override(CONFIG, { useValue: ... })` — both work; passing `source` is usually simpler when the whole point is testing validation itself.

## Next

- Every exported symbol: [`@blixis-io/config` reference](/framework/reference/blixis-config/).
- See it wired into a real app's `main.ts`: the [hello-api walkthrough](/framework/examples/hello-api-walkthrough/).
