---
title: "@blixis-io/config"
description: Full API reference for the config package.
sidebar:
  order: 6
---

Zod-validated environment configuration, wired up the same `forRoot()` way as every other `DynamicModule` in this framework. See [Configuration](/framework/concepts/config/) for the concepts.

## `defineConfigModule`

```ts
function defineConfigModule<Schema extends ZodType>(
  schema: Schema,
): {
  CONFIG: InjectionToken<z.infer<Schema>>;
  ConfigModule: {
    forRoot(source?: Record<string, string | undefined>): DynamicModule;
  };
};
```

Config shape is inherently app-specific — unlike `@blixis-io/logging`'s single fixed `LOGGER` token, there's no one type to export a token for. Each call to `defineConfigModule(schema)` returns a **new**, distinct `InjectionToken` typed to that schema's `z.infer<Schema>`, plus a `ConfigModule` class bound to it. Call it once per app (typically in its own `config.ts`), export both, and use them everywhere:

```ts
// config.ts
import { defineConfigModule } from "@blixis-io/config";
import { z } from "zod";

const AppConfigSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string(),
});

export const { CONFIG, ConfigModule } = defineConfigModule(AppConfigSchema);
```

## `ConfigModule.forRoot(source?)`

```ts
@Module({ imports: [ConfigModule.forRoot()] })
class AppModule {}
```

`source` defaults to `process.env`. Validation happens **immediately**, inside `forRoot()` itself — not deferred to a factory provider resolved later during `createApplication()`, and not deferred to first injection. A misconfigured environment fails as early as the module graph is being declared, before the container does anything.

Pass an explicit `source` to validate something other than `process.env` — most commonly a plain object in a test, as an alternative to overriding `CONFIG` through `@blixis-io/testing`'s `.override()`.

## `ConfigValidationError`

```ts
class ConfigValidationError extends Error {
  constructor(zodError: z.ZodError);
}
```

Thrown by `forRoot()` on a failed `schema.safeParse(source)`. The message lists every failing field, one per line:

```
Invalid configuration:
  - PORT: Invalid input: expected number, received string
  - DATABASE_URL: Required
```

## Injecting it

```ts
import { Inject, Injectable } from "@blixis-io/di";
import { CONFIG } from "./config.js";
import type { AppConfig } from "./config.js"; // z.infer<typeof AppConfigSchema>

@Injectable()
class DatabaseService {
  constructor(@Inject(CONFIG) private config: AppConfig) {}
}
```
