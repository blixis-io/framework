---
"create-blixis": patch
---

A freshly scaffolded app no longer starts life with 2 critical `npm audit` findings. The starter's `dev` script used the `concurrently` package, and every `concurrently` since 9.2.3 pins `shell-quote` exactly to a version with a command-injection advisory (GHSA-pqg4-j6r4-53mv), so `npm install` printed "2 critical severity vulnerabilities" in a new project. `dev` now runs `scripts/dev.mjs`, a 40-line script written into the app: it compiles once with `tsc`, then recompiles on every change while Node restarts on the new output, exactly as before, with nothing extra to install. The dev dependencies are now just `typescript` and `@types/node`. Existing apps are not touched: remove `concurrently` and copy the script if you want the same.
