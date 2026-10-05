# @blixis-io/tenancy

## 0.2.0

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
  - @blixis-io/core@0.4.0
  - @blixis-io/http@0.6.0

## 0.1.6

### Patch Changes

- Updated dependencies [[`6216026`](https://github.com/blixis-io/framework/commit/6216026a68363c4d901509d0116d52e447c95039), [`e1c471e`](https://github.com/blixis-io/framework/commit/e1c471e79715ca18ccfc009a1912e2b20f41eb08)]:
  - @blixis-io/http@0.5.0

## 0.1.5

### Patch Changes

- Updated dependencies [[`3b7c4c8`](https://github.com/blixis-io/framework/commit/3b7c4c8ff0e23d1e88a3dbc800adcbc45d9583f6)]:
  - @blixis-io/http@0.4.0

## 0.1.4

### Patch Changes

- Updated dependencies [[`3b2d859`](https://github.com/blixis-io/framework/commit/3b2d85957cba17f6cfc6273f327c042b25d7ca36)]:
  - @blixis-io/di@0.1.2
  - @blixis-io/core@0.3.1
  - @blixis-io/http@0.3.2

## 0.1.3

### Patch Changes

- Updated dependencies [[`4c34195`](https://github.com/blixis-io/framework/commit/4c34195a621dabc5d2f31e7a4eeed54a2dbc6d45)]:
  - @blixis-io/core@0.3.0
  - @blixis-io/http@0.3.1

## 0.1.2

### Patch Changes

- Updated dependencies [[`fe1f67a`](https://github.com/blixis-io/framework/commit/fe1f67af5657af8d0d2a1ba8ca0aef400617d597), [`bf86ca7`](https://github.com/blixis-io/framework/commit/bf86ca7bb675e0e735a86f37caa6f44d050938f4), [`356e859`](https://github.com/blixis-io/framework/commit/356e859423426fd3984f8a79ec31e315f5809818), [`344bc43`](https://github.com/blixis-io/framework/commit/344bc435f3ce6352f08dcd8ac1e70a81d6da89e4)]:
  - @blixis-io/di@0.1.1
  - @blixis-io/core@0.2.1
  - @blixis-io/http@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`cbc09de`](https://github.com/blixis-io/framework/commit/cbc09de1c8b2fa16d183f2d3b95d0e922c44e7e7), [`9fa4c06`](https://github.com/blixis-io/framework/commit/9fa4c0686fad9bdb6ae95630fdfd739917be87ff), [`cbc09de`](https://github.com/blixis-io/framework/commit/cbc09de1c8b2fa16d183f2d3b95d0e922c44e7e7)]:
  - @blixis-io/core@0.2.0
  - @blixis-io/http@0.2.0
