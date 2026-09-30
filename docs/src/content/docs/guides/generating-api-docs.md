---
title: Generating API Docs
description: Mount an OpenAPI 3.1 document with @blixis-io/openapi and point a UI at it.
sidebar:
  order: 9
---

`@blixis-io/openapi`'s `generateOpenApiDocument` returns a plain object — there's no auto-mounted route and no bundled Swagger UI. You mount it yourself with the same `@Controller`/`@Get` primitives as any other route. See [API Documentation](/concepts/api-documentation/) for what actually goes into the generated document.

## 1. A place to hold the app reference

The document needs `app.controllers`, but `app` doesn't exist until *after* the module graph — including whatever controller will serve the document — is already built. Solve it with a small DI-registered provider, set once right after boot:

```ts title="src/docs/app-ref.ts"
import type { HttpApplication } from "@blixis-io/http";
import { Injectable } from "@blixis-io/di";

@Injectable()
export class AppRef {
  current: HttpApplication | undefined;
}
```

## 2. The controller

```ts title="src/docs/docs.controller.ts"
import { Controller, Get } from "@blixis-io/http";
import { generateOpenApiDocument } from "@blixis-io/openapi";
import { AppRef } from "./app-ref.js";

@Controller()
export class DocsController {
  constructor(private readonly appRef: AppRef) {}

  @Get("openapi.json")
  spec() {
    if (!this.appRef.current) {
      throw new Error("AppRef.current not set — main.ts must set it right after createHttpApplication() resolves");
    }
    return generateOpenApiDocument(this.appRef.current, {
      title: "my-api",
      version: "1.0.0",
    });
  }
}
```

`AppRef.current` is only ever read here, at request time — by which point `main.ts` (below) has always already set it, since a request can't arrive before `app.listen()` runs.

## 3. The module

```ts title="src/docs/docs.module.ts"
import { Module } from "@blixis-io/core";
import { AppRef } from "./app-ref.js";
import { DocsController } from "./docs.controller.js";

@Module({ providers: [AppRef], controllers: [DocsController] })
export class DocsModule {}
```

Import `DocsModule` into your `AppModule` like any other feature module.

## 4. Set the reference in `main.ts`

```ts title="src/main.ts" ins={4}
const app = await createHttpApplication(AppModule);
app.get(AppRef).current = app;

await app.listen(3000);
```

That's it — `GET /openapi.json` now returns a live document built from whatever controllers are actually registered.

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

`@ApiOperation`/`@ApiTags` are both optional — add them where a bare, derived `operationId` isn't descriptive enough. See [API Documentation](/concepts/api-documentation/#enriching-a-route-with-apioperation-and-apitags).
