# `@blixis-io/openapi`

Generates an OpenAPI 3.1 document from a running app's real controllers. Built on `@blixis-io/http`'s decorator metadata; no serving mechanism or bundled UI of its own.

```bash
npm install @blixis-io/openapi @blixis-io/http @blixis-io/di zod
```

```ts
import { generateOpenApiDocument } from "@blixis-io/openapi";

const app = await createHttpApplication(AppModule);

const doc = generateOpenApiDocument(app, {
  title: "my-api",
  version: "1.0.0",
});
```

Reads the same `@Controller`/`@Get`/`@Body`/`@Query`/`@Param`/`@Returns` metadata the router itself already uses — no separate annotation system to keep in sync. `generateOpenApiDocument` only needs `{ controllers: readonly Class[] }`, so it's cheap to unit test without booting a real app.

Part of [Blixis Framework](https://github.com/blixis-io/framework) — full docs: [API Documentation](https://blixis-io.github.io/framework/concepts/api-documentation/) · [API reference](https://blixis-io.github.io/framework/reference/blixis-openapi/).
