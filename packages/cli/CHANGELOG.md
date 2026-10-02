# @blixis-io/cli

## 0.3.0

### Minor Changes

- [#47](https://github.com/blixis-io/framework/pull/47) [`8c10f50`](https://github.com/blixis-io/framework/commit/8c10f5040b0dad21f1f564158073b1532c596028) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - `blix run` is now a known plugin command, provided by `@blixis-io/commands`: `blix run` lists your app's `@Command` classes and `blix run <command>` runs one. `blix add run` installs the package.

## 0.2.0

### Minor Changes

- [#37](https://github.com/blixis-io/framework/pull/37) [`716312d`](https://github.com/blixis-io/framework/commit/716312da595d77f519fd70d3a2d53587d7141e56) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - `blix` can now host commands that live in other packages: `blix deploy` loads `@blixis-io/deploy` from the project's own `node_modules`, with a clear "install it with `blix add deploy`" error when it's missing. New `blix add <plugin>` (installs with the project's package manager, detected from its lockfile), `blix --version`, and a `blix.config.{ts,mts,js,mjs,json}` loader (TypeScript works natively on Node 24) with a `defineConfig` helper. Still zero runtime dependencies.
  
  **Breaking (programmatic API):** `runCli` is now async and returns a `Promise<CliResult>`. The `blix` binary is unaffected.

### Patch Changes

- [#38](https://github.com/blixis-io/framework/pull/38) [`6bc4ef9`](https://github.com/blixis-io/framework/commit/6bc4ef9e5c1cf40b477d33b4b09ca950225d47c8) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Fix a deadlock when a plugin or `blix.config.ts` imports from `@blixis-io/cli`: the `blix` bin and the library entry were the same file, so importing the library while the bin was mid-`await runCli()` waited on itself forever (`Detected unsettled top-level await`, exit 13). The bin is now `dist/bin.js` and the library `dist/index.js`, which has no top-level side effects.
