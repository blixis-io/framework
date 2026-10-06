# `@blixis-io/health`

Liveness (`/livez`) and readiness (`/readyz`) endpoints for [`@blixis-io/http`](../http). Readiness checks are registered by the providers that own the dependencies, and readiness turns to `503 draining` while the application shuts down; liveness stays `200`, because a process that is leaving is not broken.

```ts
import { defineHealthModule } from "@blixis-io/health";

export const { health, HEALTH, HealthModule } = defineHealthModule();

// in a provider that owns the database:
health.check("database", () => pool.query("select 1").then(() => undefined));

// in main.ts:
const app = await createHttpApplication(AppModule, { middleware: [health.middleware] });
health.watch(app);
```

The response body names each check and never contains the error.

Part of [Blixis Framework](https://github.com/blixis-io/framework) — full docs: [Health checks](https://blixis-io.github.io/framework/guides/health-checks/) · [API reference](https://blixis-io.github.io/framework/reference/blixis-health/).
