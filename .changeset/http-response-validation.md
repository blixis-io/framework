---
"@blixis-io/http": minor
---

New `responseValidation: "always" | "never"` option (default `"always"`) and per-route `@Returns(schema, { validate })` override, which wins in either direction. Skipping validation sends the handler's value as-is, so the schema's coercion, defaults and stripping of unknown keys no longer apply; the schema still feeds the OpenAPI document. Response parsing is now synchronous (3-4x faster on large payloads) with an automatic fallback to async for schemas with async refinements. Documents the schema's role as an output allow-list.
