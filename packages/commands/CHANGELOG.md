# @blixis-io/commands

## 0.2.4

### Patch Changes

- Updated dependencies [[`d8ba3d1`](https://github.com/blixis-io/framework/commit/d8ba3d1a99f38ef0b7a792912585c75dc4cc42d0), [`086eaa8`](https://github.com/blixis-io/framework/commit/086eaa817844318bc1e0bd113cea8da5dcb2d009), [`02329a4`](https://github.com/blixis-io/framework/commit/02329a42ab7c1946e981625b0221e09e7ee05f13), [`416994a`](https://github.com/blixis-io/framework/commit/416994a92e1d152199eb70734fa6de0e806f3545), [`d8ba3d1`](https://github.com/blixis-io/framework/commit/d8ba3d1a99f38ef0b7a792912585c75dc4cc42d0), [`1a34fc4`](https://github.com/blixis-io/framework/commit/1a34fc4afa9874f825eae7ac3d5d75b83600a399)]:
  - @blixis-io/core@0.5.0
  - @blixis-io/http@0.9.0

## 0.2.3

### Patch Changes

- Updated dependencies [[`cfa6381`](https://github.com/blixis-io/framework/commit/cfa6381bdda97bc9e22ffe0f2c32d12fc2453702), [`5f9c5ea`](https://github.com/blixis-io/framework/commit/5f9c5ea9ea541d61328e200b2b539027216ab3f0), [`6146198`](https://github.com/blixis-io/framework/commit/61461988b362941b0d231bb39a7f19bec91273e7), [`2216bc0`](https://github.com/blixis-io/framework/commit/2216bc0d93bb681b82583200814d1caa993bc098), [`47566bc`](https://github.com/blixis-io/framework/commit/47566bcfcf9c9a554e14c9afebccc29f71a06dbe), [`3329a9c`](https://github.com/blixis-io/framework/commit/3329a9c88c3b64724670c20a6809526fca3ef5b8)]:
  - @blixis-io/http@0.8.0

## 0.2.2

### Patch Changes

- Updated dependencies [[`13e89f8`](https://github.com/blixis-io/framework/commit/13e89f8030871d6cd1937959d48d6ad2a594cf2a)]:
  - @blixis-io/http@0.7.0

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
