# @blixis-io/commands

## 0.2.1

### Patch Changes

- Updated dependencies [[`9746012`](https://github.com/blixis-io/framework/commit/9746012b8513e6039a27978946ea4d07abb65f69)]:
  - @blixis-io/core@0.4.0
  - @blixis-io/http@0.6.0

## 0.2.0

### Minor Changes

- [#74](https://github.com/blixis-io/framework/pull/74) [`6216026`](https://github.com/blixis-io/framework/commit/6216026a68363c4d901509d0116d52e447c95039) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - `blix run` now provides `RequestContext` when `@blixis-io/http` is installed. Before, any app with a guard or service injecting `RequestContext` failed the whole boot with `No provider for "RequestContext"`, so none of its commands could run. It reads empty outside a request (`get` is `undefined`, `set` throws). `@blixis-io/http` is now an optional peer dependency, resolved like core and di so the app and `blix run` share one copy; apps without it boot as before.

### Patch Changes

- Updated dependencies [[`4e37519`](https://github.com/blixis-io/framework/commit/4e37519afd5a6cb9a13c948c2764f4c59cf8c99a), [`6216026`](https://github.com/blixis-io/framework/commit/6216026a68363c4d901509d0116d52e447c95039), [`e1c471e`](https://github.com/blixis-io/framework/commit/e1c471e79715ca18ccfc009a1912e2b20f41eb08)]:
  - @blixis-io/cli@0.4.1
  - @blixis-io/http@0.5.0

## 0.1.2

### Patch Changes

- Updated dependencies [[`ef36b88`](https://github.com/blixis-io/framework/commit/ef36b8860d1c3ece123e17282d31cb77b1333d80)]:
  - @blixis-io/cli@0.4.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`8c10f50`](https://github.com/blixis-io/framework/commit/8c10f5040b0dad21f1f564158073b1532c596028), [`4c34195`](https://github.com/blixis-io/framework/commit/4c34195a621dabc5d2f31e7a4eeed54a2dbc6d45)]:
  - @blixis-io/cli@0.3.0
  - @blixis-io/core@0.3.0
