# create-blixis

## 0.1.2

### Patch Changes

- [#39](https://github.com/blixis-io/framework/pull/39) [`25c058a`](https://github.com/blixis-io/framework/commit/25c058a9a87dcabb5540f218b2b157d8d37fc4b0) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - The scaffolded `package.json` now pins `packageManager` (e.g. `pnpm@11.25.0`) to the package manager that ran `create`, so a Docker image or CI job installs with the same major version instead of whichever corepack picks. Found while testing `blix deploy`: an unpinned project got pnpm 12 in its image.

## 0.1.1

### Patch Changes

- [#30](https://github.com/blixis-io/framework/pull/30) [`255a4f8`](https://github.com/blixis-io/framework/commit/255a4f8a1a1c803c749e569074670e3dc26ce79b) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - The scaffolded app now has a `dev` script (`tsc --watch` plus `node --watch` on the compiled output, via `concurrently`), and the printed next step is `dev` instead of `build && start`.
