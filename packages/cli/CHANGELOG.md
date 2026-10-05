# @blixis-io/cli

## 0.4.2

### Patch Changes

- [#87](https://github.com/blixis-io/framework/pull/87) [`325c760`](https://github.com/blixis-io/framework/commit/325c760ba01cf1278dd2275551722ecd15480efc) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Names typed on the command line no longer match properties inherited from `Object.prototype`, and the generator refuses names it can't turn into valid TypeScript.
  
  **Prototype keys.** The plugin registry, the generator aliases, the CI providers and the deploy targets were looked up as plain object properties, so `constructor`, `toString`, `valueOf`, `hasOwnProperty` and `__proto__` found something that isn't there. Fixed against the built CLI: `blix add constructor` ran `npm install -D undefined` and reported `Added undefined`; `blix constructor` said it "needs undefined, which isn't installed"; `blix g constructor users` crashed with `Unreachable: unknown generator type function Object() { [native code] }`; `blix deploy ci constructor` and `blix deploy constructor` produced nonsense providers and targets. They now say the command, plugin, type, provider or target is unknown. A deploy target that really is called `constructor` still works.
  
  **Generator names.** `blix g c 123` wrote `src/123/123.controller.ts` containing `export class 123Controller`, which is not valid TypeScript; `blix g c café` silently wrote `src/caf/caf.controller.ts`. Both are now refused with a message that says what to change (start with a letter; use ASCII letters and digits), and nothing is written, including on `--dry-run`.

## 0.4.1

### Patch Changes

- [#71](https://github.com/blixis-io/framework/pull/71) [`4e37519`](https://github.com/blixis-io/framework/commit/4e37519afd5a6cb9a13c948c2764f4c59cf8c99a) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - `blix doctor` no longer reports a duplicate `@blixis-io/core` or `@blixis-io/di` when obsolete folders are left in `node_modules/.pnpm` after a dependency change. It now counts only the copies the installed packages can actually resolve, which matches `pnpm why`, instead of every physical folder.

## 0.4.0

### Minor Changes

- [#64](https://github.com/blixis-io/framework/pull/64) [`ef36b88`](https://github.com/blixis-io/framework/commit/ef36b8860d1c3ece123e17282d31cb77b1333d80) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Add `blix doctor`: checks decorator flags in `tsconfig.json`, duplicate copies of `@blixis-io/core`/`di`, the Node version, the `packageManager` pin, and tooling that drops decorator metadata (`tsx`, `esbuild`, Vitest without Oxc settings). Exits `1` on failures.

## 0.3.0

### Minor Changes

- [#47](https://github.com/blixis-io/framework/pull/47) [`8c10f50`](https://github.com/blixis-io/framework/commit/8c10f5040b0dad21f1f564158073b1532c596028) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - `blix run` is now a known plugin command, provided by `@blixis-io/commands`: `blix run` lists your app's `@Command` classes and `blix run <command>` runs one. `blix add run` installs the package.

## 0.2.0

### Minor Changes

- [#37](https://github.com/blixis-io/framework/pull/37) [`716312d`](https://github.com/blixis-io/framework/commit/716312da595d77f519fd70d3a2d53587d7141e56) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - `blix` can now host commands that live in other packages: `blix deploy` loads `@blixis-io/deploy` from the project's own `node_modules`, with a clear "install it with `blix add deploy`" error when it's missing. New `blix add <plugin>` (installs with the project's package manager, detected from its lockfile), `blix --version`, and a `blix.config.{ts,mts,js,mjs,json}` loader (TypeScript works natively on Node 24) with a `defineConfig` helper. Still zero runtime dependencies.
  
  **Breaking (programmatic API):** `runCli` is now async and returns a `Promise<CliResult>`. The `blix` binary is unaffected.

### Patch Changes

- [#38](https://github.com/blixis-io/framework/pull/38) [`6bc4ef9`](https://github.com/blixis-io/framework/commit/6bc4ef9e5c1cf40b477d33b4b09ca950225d47c8) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Fix a deadlock when a plugin or `blix.config.ts` imports from `@blixis-io/cli`: the `blix` bin and the library entry were the same file, so importing the library while the bin was mid-`await runCli()` waited on itself forever (`Detected unsettled top-level await`, exit 13). The bin is now `dist/bin.js` and the library `dist/index.js`, which has no top-level side effects.
