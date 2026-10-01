# @blixis-io/deploy

## 0.2.0

### Minor Changes

- [#38](https://github.com/blixis-io/framework/pull/38) [`6bc4ef9`](https://github.com/blixis-io/framework/commit/6bc4ef9e5c1cf40b477d33b4b09ca950225d47c8) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - First release. `blix deploy` builds a Docker image, pushes it and runs an optional `after` command; `init` writes `blix.config.ts`, a `Dockerfile`, `.dockerignore` and a GitHub Actions workflow; `build`, `ci`, `doctor` and `--dry-run` round it out. The registry password is piped on stdin and never appears in a command line or output. Targets and CI systems are registries, so Vercel, Netlify, Cloudflare, GitLab CI and Bitbucket Pipelines can be added as adapters.

- [#41](https://github.com/blixis-io/framework/pull/41) [`fe2e6d2`](https://github.com/blixis-io/framework/commit/fe2e6d2f74573f2e2d405f1bfb84e9f1c4bfa1b9) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - Vercel and Netlify targets. `blix deploy init --target vercel|netlify` writes the function entry (`createFetchHandler`, needs `@blixis-io/http` 0.3+), the provider's config and a `public/` directory; `blix deploy` then runs your build script and the provider CLI through `npx`. The entry imports your `tsc` output so the providers' esbuild never sees decorators. Also: `init --name` to name a target, a printed snippet instead of an edit when `blix.config.*` already exists, `--app-module`/`--app-export`, and `doctor` checks `npx` and lists each provider's credentials. `init`, CI generation and `doctor` now go through the target adapter.

### Patch Changes

- Updated dependencies [[`6bc4ef9`](https://github.com/blixis-io/framework/commit/6bc4ef9e5c1cf40b477d33b4b09ca950225d47c8), [`716312d`](https://github.com/blixis-io/framework/commit/716312da595d77f519fd70d3a2d53587d7141e56)]:
  - @blixis-io/cli@0.2.0
