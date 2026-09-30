---
title: Using Dynamic Modules
description: "The forRoot() pattern for modules that need runtime configuration."
sidebar:
  order: 6
---

See [Modules](/framework/concepts/modules/#dynamic-modules-the-forroot-pattern) for the concept. This is the pattern to copy.

## 1. Define a token for the config

```ts title="src/config/config.tokens.ts"
import { InjectionToken } from "@blixis-io/di";

export interface AppConfig {
  databaseUrl: string;
}

export const APP_CONFIG = new InjectionToken<AppConfig>("app.config");
```

## 2. Give the module a static `forRoot()`

```ts title="src/config/config.module.ts"
import { Module, type DynamicModule } from "@blixis-io/core";
import { APP_CONFIG, type AppConfig } from "./config.tokens.js";

@Module()
export class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: config }],
    };
  }
}
```

The class itself stays `@Module()` with no static config — `forRoot()` returns the *extra* providers layered on top at import time, not a replacement for the class's own metadata.

## 3. Import it with configuration

```ts title="src/app.module.ts"
@Module({
  imports: [
    ConfigModule.forRoot({ databaseUrl: process.env["DATABASE_URL"]! }),
  ],
})
export class AppModule {}
```

## 4. Inject the config anywhere

```ts
@Injectable()
export class DatabaseService {
  constructor(@Inject(APP_CONFIG) private config: AppConfig) {}
}
```

## A config module that reads `process.env` directly

If you don't need per-import configuration — just "parse environment variables once, provide the typed result everywhere" — a `useFactory` provider on a normal (non-dynamic) module is simpler and avoids the pattern entirely:

```ts
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => ({ databaseUrl: process.env["DATABASE_URL"]! }),
    },
  ],
})
export class ConfigModule {}
```

Reach for `forRoot()` specifically when the *importer* needs to pass in configuration that varies per import site — a database module configured with different connection strings in different apps, say — not just "read some environment variables."

## Known limitation

Deduplication of imports is by module **class**, not by the specific dynamic configuration passed. Importing `ConfigModule.forRoot(a)` from one module and `ConfigModule.forRoot(b)` from another registers only whichever is visited first — the second is silently skipped, not merged or conflict-checked. In practice this means `forRoot()` modules should be imported exactly once, typically from the root module.
