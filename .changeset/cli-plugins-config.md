---
"@blixis-io/cli": minor
---

`blix` can now host commands that live in other packages: `blix deploy` loads `@blixis-io/deploy` from the project's own `node_modules`, with a clear "install it with `blix add deploy`" error when it's missing. New `blix add <plugin>` (installs with the project's package manager, detected from its lockfile), `blix --version`, and a `blix.config.{ts,mts,js,mjs,json}` loader (TypeScript works natively on Node 24) with a `defineConfig` helper. Still zero runtime dependencies.

**Breaking (programmatic API):** `runCli` is now async and returns a `Promise<CliResult>`. The `blix` binary is unaffected.
