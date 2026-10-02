# @blixis-io/deploy

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
