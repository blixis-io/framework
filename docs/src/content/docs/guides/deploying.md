---
title: Deploying
description: Build and ship a Blixis app with blix deploy, from your machine or from GitHub Actions.
sidebar:
  order: 12
---

`blix deploy` builds your app as a Docker image, pushes it to a registry, and can run one command afterwards so your host picks the new image up. The same command runs on your laptop and in CI, so a deploy behaves the same in both places.

Docker is the only target today. Vercel, Netlify and Cloudflare are planned. See [Compatibility](/framework/architecture/compatibility/) for what has actually been verified.

## 1. Install it

```bash
pnpm add -D @blixis-io/cli @blixis-io/deploy
# or, from a project that already has the CLI:
blix add deploy
```

## 2. Set it up

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

## CI

The generated workflow is deliberately thin: check out, install, run `blix deploy <target>`. For `ghcr.io` it uses GitHub's own `GITHUB_TOKEN` and the `packages: write` permission, so no secrets need setting up. For any other registry it reads the credentials from repository secrets named after the target's `usernameEnv` and `passwordEnv` (default `REGISTRY_USERNAME` and `REGISTRY_PASSWORD`).

GitLab CI and Bitbucket Pipelines are planned and will generate the same thing.

## What's checked

The generated workflow was parsed as valid YAML, and the full flow (`init`, `build`, a real image built from the generated Dockerfile, run, called, and stopped gracefully) was run against Docker on 2026-10-01. Pushing to a registry and the GitHub Actions run itself are covered by unit tests and a dry run, not exercised against a real registry.
