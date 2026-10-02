---
title: Deploying
description: Build and ship a Blixis app with blix deploy, from your machine or from GitHub Actions.
sidebar:
  order: 12
---

`blix deploy` builds your app as a Docker image, pushes it to a registry, and can run one command afterwards so your host picks the new image up. The same command runs on your laptop and in CI, so a deploy behaves the same in both places.

Targets: **Docker**, **Vercel**, **Netlify** and **Cloudflare Workers**. See [Compatibility](/framework/architecture/compatibility/) for what has actually been verified for each.

## 1. Install it

```bash
pnpm add -D @blixis-io/cli @blixis-io/deploy
# or, from a project that already has the CLI:
blix add deploy
```

## 2. Set it up (Docker)

```bash
blix deploy init --ci github
```

This writes four files and never overwrites one that exists (pass `--force` to replace them):

| File | What it is |
|---|---|
| `blix.config.ts` | The `deploy` section: one target, `prod`. The image name is worked out from your GitHub remote (`ghcr.io/<owner>/<repo>`). |
| `Dockerfile` | A multi-stage build: compile everything, ship only production dependencies and `dist/`, run as the `node` user. pnpm and npm projects only. For yarn or bun, write your own and set `dockerfile` on the target. |
| `.dockerignore` | Keeps `node_modules`, `.git` and `.env*` out of the image. |
| `.github/workflows/deploy.yml` | Runs `blix deploy prod` on every push to `main`. |

:::caution
If your `package.json` has no `"packageManager"` field, the image installs whichever pnpm corepack picks, which may be a different major version from yours. `init` warns about this. Pin it with `corepack use pnpm@latest`.
:::

For Vercel or Netlify, see [Vercel and Netlify](#vercel-and-netlify) below. Everything from "Look before you run" on works the same for every target.

## 3. Look before you run

```bash
blix deploy --dry-run
```

```
# deploy prod (docker), tag 6185c92
$ printenv REGISTRY_PASSWORD | docker login ghcr.io -u $REGISTRY_USERNAME --password-stdin
$ docker build -t ghcr.io/acme/api:6185c92 -f Dockerfile .
$ docker push ghcr.io/acme/api:6185c92
# would need these environment variables: REGISTRY_USERNAME, REGISTRY_PASSWORD
```

`--dry-run` prints every command and runs none of them. The password is piped to `docker login` on stdin, so it never appears in a command line or in the output.

`blix deploy doctor` checks that the config is valid, that git and Docker are available, and which required variables are set.

## 4. Deploy

```bash
REGISTRY_USERNAME=me REGISTRY_PASSWORD=<token> blix deploy
```

Steps run in order and stop at the first failure, which is named. A run that is missing a required variable refuses to start rather than failing halfway. `blix deploy build` only builds: no login, push or post-push command, and no credentials needed.

The image tag is, in order: the target's `tag`, `$BLIX_TAG`, the short git commit, then `latest`.

## Telling your host about the new image

Add an `after` command to the target. It runs once the push succeeds and sees `BLIX_IMAGE` (`ghcr.io/acme/api:6185c92`) and `BLIX_TAG`:

```ts title="blix.config.ts"
import { defineConfig } from "@blixis-io/cli";

export default defineConfig({
  deploy: {
    targets: {
      prod: {
        type: "docker",
        image: "ghcr.io/acme/api",
        registry: { host: "ghcr.io" },
        after: 'fly deploy --image "$BLIX_IMAGE"',
        env: ["FLY_API_TOKEN"],
      },
    },
  },
});
```

That one hook is how Fly, Railway, Render, or a server you reach over SSH pick up the new image. `env` lists variables the target needs: `doctor` checks them, and the generated workflow passes them through from your repository secrets.

## Several targets

```ts
targets: {
  staging: { type: "docker", image: "ghcr.io/acme/api-staging", registry: { host: "ghcr.io" } },
  prod: { type: "docker", image: "ghcr.io/acme/api", registry: { host: "ghcr.io" } },
},
default: "staging",
```

`blix deploy prod` picks one; with no argument it uses `default`, or the only target. Generate a workflow for a specific one with `blix deploy ci github prod`. A target can't be named `init`, `build`, `ci`, `doctor` or `help`.

## Vercel and Netlify

```bash
blix deploy init --target vercel --ci github
blix deploy init --target netlify --ci github
```

Both put your app behind a single serverless function. The generated entry is one plain JavaScript file that imports your **compiled** app (`dist/`, from your own `build` script) and exports a fetch handler:

```js title="api/index.mjs (Vercel)"
import { createFetchHandler } from "@blixis-io/http";
import { AppModule } from "../dist/app.module.js";

export default createFetchHandler(AppModule);
```

It needs `@blixis-io/http` 0.3 or newer. If your compiled module lives elsewhere, pass `--app-module build/root.js --app-export RootModule`. Vercel also gets a `vercel.json` (every path goes to the function) and a `public/` directory it insists on; Netlify gets a `netlify.toml` and the function in `netlify/functions/`.

`blix deploy` then runs your build script and the provider's CLI through `npx`:

```
$ pnpm run build
$ npx --yes vercel@latest deploy --yes --prod
```

```
$ pnpm run build
$ npx --yes netlify-cli@latest deploy --dir public --functions netlify/functions --prod
```

| Option on the target | |
|---|---|
| `production` | `false` deploys a preview instead (default `true`) |
| `build` | Your own build command, run through the shell (default: the package manager's `run build`) |
| `cliVersion` | The provider CLI version `npx` runs. Pin it for reproducible deploys (default `latest`) |
| `env` | Variables the target needs |
| Netlify: `site`, `dir`, `functions` | The site id (else `NETLIFY_SITE_ID`), publish directory, functions directory |

**Credentials.** Link the project once on your machine (`npx vercel link`, `npx netlify link`) and log in; `blix deploy` doesn't ask for a token. In CI, set `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (Vercel) or `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` (Netlify) as repository secrets; the generated workflow passes them through, and `blix deploy doctor` lists them.

**Why compiled JavaScript, not TypeScript.** Both providers bundle TypeScript with esbuild, which drops the decorator metadata Blixis' dependency injection needs. Handing them the output of `tsc` avoids that, and their own tracing then packages `node_modules` for you.

**On a function platform**, `listen()`, `shutdownTimeout` and `SIGTERM` handling don't apply. See [Running in Production](/framework/guides/running-in-production/#on-a-platform-that-calls-fetch-vercel-netlify-cloudflare-workers).

## Cloudflare Workers

```bash
blix deploy init --target cloudflare --ci github
```

This writes `cloudflare/worker.mjs`, a `wrangler.toml`, and the config target. The entry is plain JavaScript that imports your compiled app (`dist/`, from your own `build` script):

```js title="cloudflare/worker.mjs"
import { createFetchHandler } from "@blixis-io/http";
import { AppModule } from "../dist/app.module.js";

export default createFetchHandler(AppModule);
```

```toml title="wrangler.toml"
name = "my-api"
main = "cloudflare/worker.mjs"
compatibility_date = "2026-10-02"
compatibility_flags = ["nodejs_compat"]
```

The Worker name is derived from your package name (lower-case letters, digits and dashes; `@acme/My_API` becomes `my-api`). `nodejs_compat` is required: the framework uses `node:async_hooks`, `node:http` and `node:stream`. Pass `--app-module` and `--app-export` if your compiled module lives elsewhere. Needs `@blixis-io/http` 0.3 or newer.

`blix deploy` then runs your build script and Wrangler:

```
$ pnpm run build
$ npx --yes wrangler@latest deploy
```

| Option on the target | |
|---|---|
| `environment` | A named Wrangler environment: `wrangler deploy --env <name>` |
| `config` | A Wrangler config other than `wrangler.toml` (for example `wrangler.jsonc`), passed with `--config` |
| `build`, `cliVersion`, `env` | As for the other targets |

**Credentials.** Run `npx wrangler login` once on your machine, or set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. In CI the generated workflow passes both through from your secrets, and `blix deploy doctor` lists them.

**No bundler to install.** Cloudflare's own bundler (esbuild, inside Wrangler) builds the Worker. That is safe here because it only ever sees compiled JavaScript: the decorator metadata Blixis needs was already emitted by `tsc`. Pointing Wrangler at TypeScript source would drop it.

**What a Worker can't do like a server:** `listen()`, `shutdownTimeout` and `SIGTERM` handling don't apply (see [Running in Production](/framework/guides/running-in-production/#on-a-platform-that-calls-fetch-vercel-netlify-cloudflare-workers)), and connecting to Postgres from a Worker is not covered by `blix deploy` and has not been tested; Cloudflare offers its own routes for databases.

## If a build fails with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`

A pnpm 11 project that has just upgraded to a fresh `@blixis-io/*` release can fail its Docker build, its CI install, or Vercel's build, because pnpm refuses versions younger than 24 hours. It fixes itself after a day, or immediately with `minimumReleaseAgeExclude: ["@blixis-io/*"]` in `pnpm-workspace.yaml`. The generated Dockerfile copies `pnpm-workspace.yaml`, so the setting applies inside the image too. Details and the reasoning: [Installation](/framework/start-here/installation/#pnpm-11-skips-versions-younger-than-24-hours).

## CI

The generated workflow is deliberately thin: check out, install, run `blix deploy <target>`. For `ghcr.io` it uses GitHub's own `GITHUB_TOKEN` and the `packages: write` permission, so no secrets need setting up. For any other registry it reads the credentials from repository secrets named after the target's `usernameEnv` and `passwordEnv` (default `REGISTRY_USERNAME` and `REGISTRY_PASSWORD`).

For Vercel and Netlify the workflow has no registry step and passes the provider's secrets instead.

### GitLab CI and Bitbucket Pipelines

```bash
blix deploy init --ci gitlab        # .gitlab-ci.yml
blix deploy init --ci bitbucket     # bitbucket-pipelines.yml
blix deploy ci gitlab               # regenerate for a configured target (also: bitbucket)
```

Both generate one job that runs in a plain `node` image on pushes to your branch (`--branch`, default `main`): install with your package manager, then `blix deploy <target>`. The same logic as everywhere else, in a different wrapper. What differs from GitHub:

- **Docker targets need a Docker daemon**, which neither system's default job image has. GitLab gets the `docker:27-dind` service and the Docker client downloaded into the job; Bitbucket gets its `docker` service, plus the client downloaded only if the image lacks one. Vercel and Netlify jobs have no Docker part.
- **Secrets are CI/CD variables you set yourself** (GitLab: Settings > CI/CD > Variables, masked; Bitbucket: Repository settings > Pipelines > Repository variables, secured). A comment at the top of each generated file lists exactly which. On GitLab, for `registry.gitlab.com` the credentials come from GitLab's own `CI_REGISTRY_USER` / `CI_REGISTRY_PASSWORD`, so nothing needs setting.
- **pnpm and yarn run `corepack enable`** first, so the version pinned in `packageManager` is the one used (see the pnpm note above); bun is installed with npm.

## What's checked

**Docker:** the generated workflow parsed as valid YAML, and the full flow (`init`, `build`, a real image built from the generated Dockerfile, run, called, and stopped gracefully) was run against Docker on 2026-10-01. Pushing to a registry and the GitHub Actions run itself are covered by unit tests and a dry run, not exercised against a real registry.

**GitLab CI and Bitbucket Pipelines:** the generated files were parsed as valid YAML and their structure checked. The job's own commands were run in a clean `node:24` container, the way the CI system would: `corepack enable`, `pnpm install --frozen-lockfile` and `blix deploy` (pnpm, with the pinned pnpm used), and `npm ci` and `blix deploy` (npm), each with `--dry-run`. The Docker client download was run in `node:24` on `linux/amd64`. **Not run:** the pipelines on GitLab or Bitbucket themselves, so the Docker-in-Docker service on GitLab and Bitbucket's `docker` service are unverified.

**Cloudflare Workers:** from files `blix deploy init` generated, Wrangler's own bundler produced the Worker (`wrangler deploy --dry-run`, 861 KiB / 138 KiB gzipped) and `wrangler dev --local` ran it in the Workers runtime, answering a request and a 404. The final `wrangler deploy` needs an account, so it was checked as a dry-run command only.

**Vercel and Netlify:** from files `blix deploy init` generated, Vercel's own `vercel build` produced a function that answered correctly, and Netlify's own `functions:build` produced a zip that answered correctly when extracted and run. The final `vercel deploy` and `netlify deploy` calls need an account, so they were checked as dry-run commands only.
