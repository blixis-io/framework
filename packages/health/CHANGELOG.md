# @blixis-io/health

## 0.1.0

### Minor Changes

- [#127](https://github.com/blixis-io/framework/pull/127) [`353e0da`](https://github.com/blixis-io/framework/commit/353e0dab4583ea02266b986bf8842d6ed58197aa) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - First release: liveness and readiness endpoints for `@blixis-io/http`. `/livez` answers `200` without running anything; `/readyz` runs every registered check at the same time, each with a timeout, and answers `200` or `503` with the name and result of each check but never the error. Checks are registered by the providers that own the dependencies (`HEALTH` token, `health.check(name, fn)`), and `health.watch(app)` makes readiness answer `503 draining` from `app.startDraining()` or `app.close()` while liveness stays `200`. The middleware answers before logging and rate limits when placed first, `HEAD` is supported, and a check that starts failing is written to `console.error` once (or every failure goes to `onCheckFailed`).

### Patch Changes

- Updated dependencies [[`d8ba3d1`](https://github.com/blixis-io/framework/commit/d8ba3d1a99f38ef0b7a792912585c75dc4cc42d0), [`086eaa8`](https://github.com/blixis-io/framework/commit/086eaa817844318bc1e0bd113cea8da5dcb2d009), [`02329a4`](https://github.com/blixis-io/framework/commit/02329a42ab7c1946e981625b0221e09e7ee05f13), [`416994a`](https://github.com/blixis-io/framework/commit/416994a92e1d152199eb70734fa6de0e806f3545), [`d8ba3d1`](https://github.com/blixis-io/framework/commit/d8ba3d1a99f38ef0b7a792912585c75dc4cc42d0), [`1a34fc4`](https://github.com/blixis-io/framework/commit/1a34fc4afa9874f825eae7ac3d5d75b83600a399)]:
  - @blixis-io/core@0.5.0
  - @blixis-io/http@0.9.0
