# @blixis-io/deploy

## 0.5.0

### Minor Changes

- [#90](https://github.com/blixis-io/framework/pull/90) [`2afec3b`](https://github.com/blixis-io/framework/commit/2afec3babb9cc22056732602b7ce7722890b6adf) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Two changes to what `blix deploy` trusts. Both can make an existing config behave differently, so read this before upgrading.
  
  **Provider CLIs are pinned.** The Vercel, Netlify and Cloudflare targets ran `npx --yes <cli>@latest` with your deploy token in the environment, so a compromised release of any of those CLIs would have run with your credentials the moment it was published. They now default to a pinned version (`vercel` 62.2.0, `netlify-cli` 27.11.0, `wrangler` 4.147.0), `blix deploy init` writes it into `blix.config.ts` so your repository decides when it changes, and `blix deploy doctor` shows the version each target runs and warns about `"latest"`. A target with no `cliVersion` of its own will now run the pinned version instead of whatever is newest; set `cliVersion` to the version you want, or `"latest"` to keep the old behaviour. Each pinned version was checked to exist on npm, not be deprecated and support Node 24, and its command was checked with `--dry-run`; **none was used for a real deployment**, which needs provider accounts.
  
  **Unknown options are errors.** The `deploy` schemas silently dropped keys they didn't know, so a typo left the default in force: `{ type: "docker", pussh: false }` still pushed the image. An unknown option is now an error that names it and suggests the closest valid one (`unknown option "pussh" (did you mean "push"?)`), in the deploy section, in targets and in `registry`. A config that already contains a typo or a key from another tool will now be refused; remove or fix the key.

## 0.4.2

### Patch Changes

- [#87](https://github.com/blixis-io/framework/pull/87) [`325c760`](https://github.com/blixis-io/framework/commit/325c760ba01cf1278dd2275551722ecd15480efc) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Names typed on the command line no longer match properties inherited from `Object.prototype`, and the generator refuses names it can't turn into valid TypeScript.
  
  **Prototype keys.** The plugin registry, the generator aliases, the CI providers and the deploy targets were looked up as plain object properties, so `constructor`, `toString`, `valueOf`, `hasOwnProperty` and `__proto__` found something that isn't there. Fixed against the built CLI: `blix add constructor` ran `npm install -D undefined` and reported `Added undefined`; `blix constructor` said it "needs undefined, which isn't installed"; `blix g constructor users` crashed with `Unreachable: unknown generator type function Object() { [native code] }`; `blix deploy ci constructor` and `blix deploy constructor` produced nonsense providers and targets. They now say the command, plugin, type, provider or target is unknown. A deploy target that really is called `constructor` still works.
  
  **Generator names.** `blix g c 123` wrote `src/123/123.controller.ts` containing `export class 123Controller`, which is not valid TypeScript; `blix g c café` silently wrote `src/caf/caf.controller.ts`. Both are now refused with a message that says what to change (start with a letter; use ASCII letters and digits), and nothing is written, including on `--dry-run`.
- Updated dependencies [[`325c760`](https://github.com/blixis-io/framework/commit/325c760ba01cf1278dd2275551722ecd15480efc)]:
  - @blixis-io/cli@0.4.2

## 0.4.1

### Patch Changes

- [#66](https://github.com/blixis-io/framework/pull/66) [`7e98dcf`](https://github.com/blixis-io/framework/commit/7e98dcffc7620d7e4ddf2d969f0b091eddf35c5e) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Read `app.module` and `app.export` from existing `blix.config` when generating Vercel, Netlify and Cloudflare entries with `blix deploy init`. Explicit app flags override each config value, and missing fields retain the conventional defaults. Reject invalid app settings before writing provider files.
- Updated dependencies [[`ef36b88`](https://github.com/blixis-io/framework/commit/ef36b8860d1c3ece123e17282d31cb77b1333d80)]:
  - @blixis-io/cli@0.4.0

## 0.4.0

### Minor Changes

- [#56](https://github.com/blixis-io/framework/pull/56) [`a7f90d9`](https://github.com/blixis-io/framework/commit/a7f90d9688cfe1ed5b480cae0ab178f99784b8f0) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Cloudflare Workers target. `blix deploy init --target cloudflare` writes `cloudflare/worker.mjs` (`export default createFetchHandler(AppModule)` over your compiled app) and a `wrangler.toml` with `nodejs_compat`, the Worker name derived from your package name; `blix deploy` then runs your build script and `npx wrangler deploy` (`environment` and `config` options). No bundler is added: Wrangler's own esbuild only ever sees compiled JavaScript, so the decorator metadata `tsc` emitted survives. CI files pass `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Needs `@blixis-io/http` 0.3+ and, until released, the `di`/`core` fix that stops the duplicate-copy guard crashing in Workers.

## 0.3.0

### Minor Changes

- [#53](https://github.com/blixis-io/framework/pull/53) [`96055bf`](https://github.com/blixis-io/framework/commit/96055bfbd11ce5253b4ef53ca2475117f1ceae2c) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - GitLab CI and Bitbucket Pipelines generators: `blix deploy init --ci gitlab|bitbucket` and `blix deploy ci gitlab|bitbucket` write `.gitlab-ci.yml` or `bitbucket-pipelines.yml`. One job in a plain `node` image: install with your package manager (`corepack enable` first for pnpm and yarn), then `blix deploy <target>`. Docker targets get a Docker daemon (GitLab's `docker:27-dind` service plus the client; Bitbucket's `docker` service, with the client installed only if missing); Vercel and Netlify jobs get none. A comment at the top of each file lists the CI/CD variables to set, and on `registry.gitlab.com` the credentials come from GitLab's own variables. Adapters now report whether the deploy runs Docker (`ci().docker`).

## 0.2.1

### Patch Changes

- Updated dependencies [[`8c10f50`](https://github.com/blixis-io/framework/commit/8c10f5040b0dad21f1f564158073b1532c596028)]:
  - @blixis-io/cli@0.3.0

## 0.2.0

### Minor Changes

- [#38](https://github.com/blixis-io/framework/pull/38) [`6bc4ef9`](https://github.com/blixis-io/framework/commit/6bc4ef9e5c1cf40b477d33b4b09ca950225d47c8) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - First release. `blix deploy` builds a Docker image, pushes it and runs an optional `after` command; `init` writes `blix.config.ts`, a `Dockerfile`, `.dockerignore` and a GitHub Actions workflow; `build`, `ci`, `doctor` and `--dry-run` round it out. The registry password is piped on stdin and never appears in a command line or output. Targets and CI systems are registries, so Vercel, Netlify, Cloudflare, GitLab CI and Bitbucket Pipelines can be added as adapters.

- [#41](https://github.com/blixis-io/framework/pull/41) [`fe2e6d2`](https://github.com/blixis-io/framework/commit/fe2e6d2f74573f2e2d405f1bfb84e9f1c4bfa1b9) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Vercel and Netlify targets. `blix deploy init --target vercel|netlify` writes the function entry (`createFetchHandler`, needs `@blixis-io/http` 0.3+), the provider's config and a `public/` directory; `blix deploy` then runs your build script and the provider CLI through `npx`. The entry imports your `tsc` output so the providers' esbuild never sees decorators. Also: `init --name` to name a target, a printed snippet instead of an edit when `blix.config.*` already exists, `--app-module`/`--app-export`, and `doctor` checks `npx` and lists each provider's credentials. `init`, CI generation and `doctor` now go through the target adapter.

### Patch Changes

- Updated dependencies [[`6bc4ef9`](https://github.com/blixis-io/framework/commit/6bc4ef9e5c1cf40b477d33b4b09ca950225d47c8), [`716312d`](https://github.com/blixis-io/framework/commit/716312da595d77f519fd70d3a2d53587d7141e56)]:
  - @blixis-io/cli@0.2.0
