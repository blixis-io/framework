# `@blixis-io/config`

Zod-validated environment config, built on [`@blixis-io/core`](https://www.npmjs.com/package/@blixis-io/core), HTTP-independent.

```bash
npm install @blixis-io/config @blixis-io/core @blixis-io/di zod
```

```ts
import { defineConfigModule } from "@blixis-io/config";
import { z } from "zod";

const AppConfigSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string(),
});

export const { CONFIG, ConfigModule } = defineConfigModule(AppConfigSchema);
```

```ts
@Module({ imports: [ConfigModule.forRoot()] })
class AppModule {}
```

`forRoot()` validates `process.env` synchronously, the moment it's called — a missing or malformed variable throws `ConfigValidationError` at boot, before the app ever starts resolving providers, never on first use deep in a request.

Part of [Blixis Framework](https://github.com/blixis-io/framework) — full docs: [Configuration](https://blixis-io.github.io/framework/concepts/config/) · [API reference](https://blixis-io.github.io/framework/reference/blixis-config/).
