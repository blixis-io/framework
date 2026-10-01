---
title: Generating API Docs
description: Mount an OpenAPI 3.1 document with @blixis-io/openapi and point a UI at it.
sidebar:
  order: 9
---

`@blixis-io/openapi` generates an OpenAPI 3.1 document from your real controllers. There's no bundled Swagger UI. See [API Documentation](/framework/concepts/api-documentation/) for what goes into the generated document.

## Serving the document

One call after boot:

```ts title="src/main.ts" ins={4}
import { serveOpenApi } from "@blixis-io/openapi";

const app = await createHttpApplication(AppModule);
serveOpenApi(app, "/openapi.json", { title: "my-api", version: "1.0.0" });

await app.listen(3000);
```

`GET /openapi.json` now returns a live document built from whatever controllers are registered. It's generated on the first request and cached, since the controller list is fixed after boot.

The route is **public**: `serveOpenApi` uses `app.mount()`, which serves an exact path ahead of the router and bypasses guards and interceptors. If the document must be protected, don't use `serveOpenApi` — build it yourself with `generateOpenApiDocument(app, options)` inside a normal guarded controller. That needs a reference to the finished app, which a controller can't get at construction time; the usual workaround is a small DI-registered holder set right after `createHttpApplication()` resolves (see the [hello-api walkthrough](/framework/examples/hello-api-walkthrough/)).

Generating the document never requires mounting it: `generateOpenApiDocument(app, options)` is a plain function returning a plain object, usable in a build script or test.

## Pointing a UI at it

Neither Swagger UI nor Redoc are bundled — both work as static HTML pages that fetch a spec URL at runtime, so pointing either at your running app's `/openapi.json` is enough:

```html
<!-- any static file, or a route returning this -->
<script src="https://cdn.jsdelivr.net/npm/@stoplight/elements/web-components.min.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@stoplight/elements/styles.min.css">
<elements-api apiDescriptionUrl="/openapi.json" router="hash"></elements-api>
```

Or run one locally against it (`npx @redocly/cli preview-docs http://localhost:3000/openapi.json`) without adding anything to your app at all.

## Enriching routes as you go

`@ApiOperation`/`@ApiTags` are both optional — add them where a bare, derived `operationId` isn't descriptive enough. See [API Documentation](/framework/concepts/api-documentation/#enriching-a-route-with-apioperation-and-apitags).
