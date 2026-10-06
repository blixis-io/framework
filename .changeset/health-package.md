---
"@blixis-io/health": minor
---

First release (the package stays private until its npm placeholder exists, so this changeset does not publish yet): liveness and readiness endpoints for `@blixis-io/http`. `/livez` answers `200` without running anything; `/readyz` runs every registered check at the same time, each with a timeout, and answers `200` or `503` with the name and result of each check but never the error. Checks are registered by the providers that own the dependencies (`HEALTH` token, `health.check(name, fn)`), and `health.watch(app)` makes readiness answer `503 draining` from `app.startDraining()` or `app.close()` while liveness stays `200`. The middleware answers before logging and rate limits when placed first, `HEAD` is supported, and a check that starts failing is written to `console.error` once (or every failure goes to `onCheckFailed`).
