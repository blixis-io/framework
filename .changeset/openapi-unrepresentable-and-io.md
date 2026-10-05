---
"@blixis-io/openapi": patch
---

The OpenAPI document no longer fails for common schemas, and describes requests the way clients send them.

**No more 500 from `/openapi.json`.** A `z.date()` or any `.transform()` made Zod's JSON Schema conversion throw, which took down the whole document: `serveOpenApi` answered `500` and `generateOpenApiDocument` threw. A `z.date()` is now documented as a `date-time` string, other types JSON Schema can't express (a transform's output, `z.custom()`) as an open schema, and a schema that can't be converted at all as an open schema whose `description` says why. Every other operation is unaffected.

**Requests use the input side of a schema, responses the output side.** A field with `.default()` was documented as required in a request body although the client may leave it out; it is now optional there, and required in the response (where the default has been applied). A `.transform()` in a request is documented by what the client sends.

**Query parameters are found for any object schema.** They were only documented for a bare `z.object()`: wrapping it in `.transform()` documented nothing, silently. Parameters are now read from the schema's JSON Schema, so `.refine()`, `.transform()` and `.strict()` all work, and a key is `required` only when it has no default and isn't optional.

**One visible difference:** a request body no longer carries `additionalProperties: false` unless the schema is `.strict()`, because a plain `z.object()` accepts extra keys and strips them. Responses are unchanged.
