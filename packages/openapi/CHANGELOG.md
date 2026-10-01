# @blixis-io/openapi

## 0.2.0

### Minor Changes

- [#28](https://github.com/blixis-io/framework/pull/28) [`9fa4c06`](https://github.com/blixis-io/framework/commit/9fa4c0686fad9bdb6ae95630fdfd739917be87ff) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - New `serveOpenApi(app, path, options)`: mounts the generated document at `path` in one call, replacing the hand-rolled `AppRef` holder pattern for the common case. The route is public; `generateOpenApiDocument` remains for guarded or non-HTTP use.

### Patch Changes

- Updated dependencies [[`9fa4c06`](https://github.com/blixis-io/framework/commit/9fa4c0686fad9bdb6ae95630fdfd739917be87ff), [`cbc09de`](https://github.com/blixis-io/framework/commit/cbc09de1c8b2fa16d183f2d3b95d0e922c44e7e7)]:
  - @blixis-io/http@0.2.0
