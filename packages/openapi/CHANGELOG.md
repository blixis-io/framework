# @blixis-io/openapi

## 0.4.1

### Patch Changes

- [#94](https://github.com/blixis-io/framework/pull/94) [`1799abd`](https://github.com/blixis-io/framework/commit/1799abd36603d01caa5205ecf8d9a913b00097a7) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - The OpenAPI document no longer fails for common schemas, and describes requests the way clients send them.
  
  **No more 500 from `/openapi.json`.** A `z.date()` or any `.transform()` made Zod's JSON Schema conversion throw, which took down the whole document: `serveOpenApi` answered `500` and `generateOpenApiDocument` threw. A `z.date()` is now documented as a `date-time` string, other types JSON Schema can't express (a transform's output, `z.custom()`) as an open schema, and a schema that can't be converted at all as an open schema whose `description` says why. Every other operation is unaffected.
  
  **Requests use the input side of a schema, responses the output side.** A field with `.default()` was documented as required in a request body although the client may leave it out; it is now optional there, and required in the response (where the default has been applied). A `.transform()` in a request is documented by what the client sends.
  
  **Query parameters are found for any object schema.** They were only documented for a bare `z.object()`: wrapping it in `.transform()` documented nothing, silently. Parameters are now read from the schema's JSON Schema, so `.refine()`, `.transform()` and `.strict()` all work, and a key is `required` only when it has no default and isn't optional.
  
  **One visible difference:** a request body no longer carries `additionalProperties: false` unless the schema is `.strict()`, because a plain `z.object()` accepts extra keys and strips them. Responses are unchanged.

## 0.4.0

### Minor Changes

- [#85](https://github.com/blixis-io/framework/pull/85) [`13e89f8`](https://github.com/blixis-io/framework/commit/13e89f8030871d6cd1937959d48d6ad2a594cf2a) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - No code change: the peer range on `@blixis-io/http` moves to `^0.7.0`, because `http` 0.7.0 is released with these packages. Upgrade `@blixis-io/http` alongside them.

### Patch Changes

- Updated dependencies [[`13e89f8`](https://github.com/blixis-io/framework/commit/13e89f8030871d6cd1937959d48d6ad2a594cf2a)]:
  - @blixis-io/http@0.7.0

## 0.3.0

### Minor Changes

- [#76](https://github.com/blixis-io/framework/pull/76) [`9746012`](https://github.com/blixis-io/framework/commit/9746012b8513e6039a27978946ea4d07abb65f69) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - `@blixis-io/core`, `@blixis-io/di`, `@blixis-io/http`, `zod` and `drizzle-orm` are now **peer dependencies** of the packages that build on them, instead of exact-version dependencies. Before, the libraries pinned exact versions (for example `auth` required `core 0.3.1`), so upgrading `core` by a patch left every library on its own older copy and the app ended up with two. Now your project installs each once and every package shares it; a version that doesn't fit is reported by the package manager at install time.
  
  **What you need to do:** make sure your project depends on what the packages you use build on. pnpm and npm 7+ install missing peers automatically; with yarn or bun, or to be explicit, add them. Per package:
  
  - `core`: `di`
  - `http`: `core`, `di`, `zod`
  - `auth`, `tenancy`, `testing`: `http` (and so `core`, `di`, `zod`); `tenancy` also `drizzle-orm`
  - `openapi`: `http`, `di`, `zod`
  - `config`: `core`, `di`, `zod`
  - `events`, `logging`: `core`, `di`
  - `db`: `core`, `di`, `drizzle-orm` (`pg` is still installed for you)
  
  `create-blixis` now installs `zod`, which `@blixis-io/http` needs. See Installation in the docs for the full table.

### Patch Changes

- Updated dependencies [[`9746012`](https://github.com/blixis-io/framework/commit/9746012b8513e6039a27978946ea4d07abb65f69)]:
  - @blixis-io/http@0.6.0

## 0.2.5

### Patch Changes

- Updated dependencies [[`6216026`](https://github.com/blixis-io/framework/commit/6216026a68363c4d901509d0116d52e447c95039), [`e1c471e`](https://github.com/blixis-io/framework/commit/e1c471e79715ca18ccfc009a1912e2b20f41eb08)]:
  - @blixis-io/http@0.5.0

## 0.2.4

### Patch Changes

- Updated dependencies [[`3b7c4c8`](https://github.com/blixis-io/framework/commit/3b7c4c8ff0e23d1e88a3dbc800adcbc45d9583f6)]:
  - @blixis-io/http@0.4.0

## 0.2.3

### Patch Changes

- Updated dependencies [[`3b2d859`](https://github.com/blixis-io/framework/commit/3b2d85957cba17f6cfc6273f327c042b25d7ca36)]:
  - @blixis-io/di@0.1.2
  - @blixis-io/http@0.3.2

## 0.2.2

### Patch Changes

- Updated dependencies []:
  - @blixis-io/http@0.3.1

## 0.2.1

### Patch Changes

- Updated dependencies [[`fe1f67a`](https://github.com/blixis-io/framework/commit/fe1f67af5657af8d0d2a1ba8ca0aef400617d597), [`bf86ca7`](https://github.com/blixis-io/framework/commit/bf86ca7bb675e0e735a86f37caa6f44d050938f4), [`356e859`](https://github.com/blixis-io/framework/commit/356e859423426fd3984f8a79ec31e315f5809818), [`344bc43`](https://github.com/blixis-io/framework/commit/344bc435f3ce6352f08dcd8ac1e70a81d6da89e4)]:
  - @blixis-io/di@0.1.1
  - @blixis-io/http@0.3.0

## 0.2.0

### Minor Changes

- [#28](https://github.com/blixis-io/framework/pull/28) [`9fa4c06`](https://github.com/blixis-io/framework/commit/9fa4c0686fad9bdb6ae95630fdfd739917be87ff) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - New `serveOpenApi(app, path, options)`: mounts the generated document at `path` in one call, replacing the hand-rolled `AppRef` holder pattern for the common case. The route is public; `generateOpenApiDocument` remains for guarded or non-HTTP use.

### Patch Changes

- Updated dependencies [[`9fa4c06`](https://github.com/blixis-io/framework/commit/9fa4c0686fad9bdb6ae95630fdfd739917be87ff), [`cbc09de`](https://github.com/blixis-io/framework/commit/cbc09de1c8b2fa16d183f2d3b95d0e922c44e7e7)]:
  - @blixis-io/http@0.2.0
