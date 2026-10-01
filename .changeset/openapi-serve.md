---
"@blixis-io/openapi": minor
---

New `serveOpenApi(app, path, options)`: mounts the generated document at `path` in one call, replacing the hand-rolled `AppRef` holder pattern for the common case. The route is public; `generateOpenApiDocument` remains for guarded or non-HTTP use.
