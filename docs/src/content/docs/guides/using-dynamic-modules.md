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

## Registering one module more than once

Each `forRoot()` call is its own registration, so the same module class can be imported several times with different configuration — two database connections, say. The one rule: **each registration must provide its own token**, because every provider token is unique across the application. Let the caller choose the token:

```ts
const PRIMARY_DB = new InjectionToken<Database>("primary-db");
const AUDIT_DB = new InjectionToken<Database>("audit-db");

@Module()
class DatabaseModule {
  static forRoot(token: InjectionToken<Database>, url: string): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [{ provide: token, useFactory: () => connect(url) }],
      exports: [token],
    };
  }
}

@Module({
  imports: [DatabaseModule.forRoot(PRIMARY_DB, primaryUrl), DatabaseModule.forRoot(AUDIT_DB, auditUrl)],
})
class AppModule {}
```

Consumers inject whichever token they want. Two registrations that provide the *same* token fail at boot with `DuplicateProviderError`.

The class's own `@Module({ providers, controllers })` are registered once, by the first registration, and every registration can depend on them. Importing the same registration object (`const db = DatabaseModule.forRoot(...)`) from several places is fine — it is collected once. Importing the plain class alongside `forRoot()` registrations resolves to the first registration of that class.
