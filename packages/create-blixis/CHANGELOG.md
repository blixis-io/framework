# create-blixis

## 0.2.2

### Patch Changes

- [#114](https://github.com/blixis-io/framework/pull/114) [`97ad0eb`](https://github.com/blixis-io/framework/commit/97ad0ebe95833baa9452b758693e4e9afab49451) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - A freshly scaffolded app no longer starts life with 2 critical `npm audit` findings. The starter's `dev` script used the `concurrently` package, and every `concurrently` since 9.2.3 pins `shell-quote` exactly to a version with a command-injection advisory (GHSA-pqg4-j6r4-53mv), so `npm install` printed "2 critical severity vulnerabilities" in a new project. `dev` now runs `scripts/dev.mjs`, a 40-line script written into the app: it compiles once with `tsc`, then recompiles on every change while Node restarts on the new output, exactly as before, with nothing extra to install. The dev dependencies are now just `typescript` and `@types/node`. Existing apps are not touched: remove `concurrently` and copy the script if you want the same.

## 0.2.1

### Patch Changes

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

## 0.2.0

### Minor Changes

- [#58](https://github.com/blixis-io/framework/pull/58) [`eacb908`](https://github.com/blixis-io/framework/commit/eacb90841ff063051c5d2cb84be1accce2ccf632) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - `--deploy <target>` (docker, vercel, netlify or cloudflare) and `--ci <provider>` (github, gitlab or bitbucket) set up deployment as part of scaffolding: after the dependencies are installed it also installs `@blixis-io/cli` and `@blixis-io/deploy` and runs `blix deploy init` in the new project, with the project's own package manager. If that last step fails the app is still created and the message says to run `blix deploy init` yourself. With `--no-install` the deploy commands are printed instead. `--ci` without `--deploy` is rejected before anything is written.

## 0.1.2

### Patch Changes

- [#39](https://github.com/blixis-io/framework/pull/39) [`25c058a`](https://github.com/blixis-io/framework/commit/25c058a9a87dcabb5540f218b2b157d8d37fc4b0) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - The scaffolded `package.json` now pins `packageManager` (e.g. `pnpm@11.25.0`) to the package manager that ran `create`, so a Docker image or CI job installs with the same major version instead of whichever corepack picks. Found while testing `blix deploy`: an unpinned project got pnpm 12 in its image.

## 0.1.1

### Patch Changes

- [#30](https://github.com/blixis-io/framework/pull/30) [`255a4f8`](https://github.com/blixis-io/framework/commit/255a4f8a1a1c803c749e569074670e3dc26ce79b) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - The scaffolded app now has a `dev` script (`tsc --watch` plus `node --watch` on the compiled output, via `concurrently`), and the printed next step is `dev` instead of `build && start`.
