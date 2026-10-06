---
"@blixis-io/openapi": minor
---

The document now matches what the framework really sends, and can describe authentication.

- Errors are documented under `application/problem+json`, the media type the handler sends; before they were `application/json`. `OpenApiResponse.content` is now `Record<string, { schema }>` instead of a fixed `application/json` key.
- `requestBody.required` is `false` when the schema accepts a missing value (`.optional()`, `z.unknown()`), as the handler reads an empty body as `undefined`.
- A route whose `@Returns` schema accepts `undefined` (and has no `@HttpCode`) also documents `204`.
- New `securitySchemes` and `security` options, and an `@ApiSecurity` decorator (class or method; `@ApiSecurity(false)` marks a route public). A requirement naming an undeclared scheme throws, naming the route. It documents only; guards still enforce.
- New `onUnrepresentable: "open" | "warn" | "throw"` (default `"open"`, the old behaviour) so a build can fail, or at least log the route, when a schema can't be expressed.
- Generation now throws when two operations share an `operationId`, naming both, instead of emitting an invalid document.
