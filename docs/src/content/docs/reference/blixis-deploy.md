---
title: "@blixis-io/deploy"
description: Reference for blix deploy and its configuration.
sidebar:
  order: 13
---

The `blix deploy` command, loaded by `blix` from your project's `node_modules`. See [Deploying](/framework/guides/deploying/) for the walkthrough.

## Commands

```
blix deploy [target] [--dry-run]
blix deploy build [target] [--dry-run]
blix deploy init [--target docker|vercel|netlify|cloudflare] [--name prod] [--ci github] [--branch main] [--force]
blix deploy init --target docker [--image <name>] [--entry dist/main.js]
blix deploy init --target vercel|netlify|cloudflare [--app-module dist/app.module.js] [--app-export AppModule]
blix deploy ci <provider> [target] [--branch main] [--force]
blix deploy doctor [target]
```

| Command | |
|---|---|
| `blix deploy [target]` | Runs the full plan: log in, build, push, then the `after` command. Without a target: `deploy.default`, else the only target. |
| `build` | Only builds. Needs no credentials. |
| `init` | Writes `blix.config.ts`, the files the target needs, and optionally a CI file. Never overwrites without `--force`. If a config already exists it prints the target to add instead of editing it. `--name` names the target (default `prod`). |
| `ci` | (Re)generates the CI file for a configured target. Providers: `github` (`.github/workflows/deploy.yml`), `gitlab` (`.gitlab-ci.yml`), `bitbucket` (`bitbucket-pipelines.yml`). |
| `doctor` | Checks config, git, Docker, and which required variables are set. Exits `1` only if Docker is missing or the config is invalid. |

`--dry-run` prints each command as `$ ...` and runs nothing. Options accept `--name value` or `--name=value`. Every error exits `1`.

For Vercel, Netlify and Cloudflare, `init` reads `app.module` and `app.export` from your existing `blix.config`, just like `blix run`. Each explicit `--app-module` or `--app-export` flag overrides its config value. Missing fields default to `dist/app.module.js` and `AppModule`. Invalid app settings fail before files are written. Docker uses `--entry` (default `dist/main.js`) instead.

These values are used when generating the function or Worker entry. After changing them, regenerate the entry with `init --force` or edit its import yourself.

## Configuration

The `deploy` section of `blix.config.ts`:

```ts
interface DeployConfig {
  targets: Record<string, Target>;
  default?: string; // used when no target is named
}

interface DockerTarget {
  type: "docker";
  image: string; // no tag, e.g. "ghcr.io/acme/api"
  registry?: {
    host: string;
    usernameEnv?: string; // default "REGISTRY_USERNAME"
    passwordEnv?: string; // default "REGISTRY_PASSWORD"
  };
  dockerfile?: string; // default "Dockerfile"
  context?: string; // default "."
  platform?: string; // e.g. "linux/amd64"
  tag?: string; // default: $BLIX_TAG, else the short git commit, else "latest"
  push?: boolean; // default true
  after?: string; // shell command run after the push; sees BLIX_IMAGE and BLIX_TAG
  env?: string[]; // variable names this target needs
}
```

```ts
interface VercelTarget {
  type: "vercel";
  production?: boolean; // default true; false = preview
  build?: string; // default: "<package manager> run build"
  cliVersion?: string; // default "latest"
  env?: string[];
}

interface NetlifyTarget {
  type: "netlify";
  production?: boolean;
  build?: string;
  cliVersion?: string;
  env?: string[];
  dir?: string; // publish directory, default "public"
  functions?: string; // default "netlify/functions"
  site?: string; // else NETLIFY_SITE_ID
}
```

```ts
interface CloudflareTarget {
  type: "cloudflare";
  environment?: string; // wrangler deploy --env <name>
  config?: string; // default "wrangler.toml"; passed with --config only when different
  build?: string;
  cliVersion?: string; // default "latest"
  env?: string[];
}
```

The config is validated with Zod; an invalid one fails with every problem and its path (`deploy.targets.prod.image: ...`). `defineDeployConfig(config)` is an identity helper for autocomplete.

## Programmatic API

Everything the command uses is exported, so another tool can plan a deploy without running one:

```ts
import { adapterFor, parseDeployConfig, selectTarget, formatStep } from "@blixis-io/deploy";

const config = parseDeployConfig(loadedConfig);
const { name, target } = selectTarget(config, "prod");
const adapter = adapterFor(name, target);
const tag = await adapter.resolveTag(process.env, process.cwd(), runner);
const { steps, missingEnv } = adapter.plan("deploy", { cwd: process.cwd(), env: process.env, tag });
steps.map(formatStep); // ["docker build -t ...", ...]
```

`initPlanFor(type, context)` returns what `init` would write (the target for the config, files, notes), so another tool can scaffold a target too.

A plan is a list of `Step`s (`command`, `args`, optional `env`, `stdinFromEnv`, `shell`). A `Runner` executes them; `processRunner` is the real one, and tests inject a fake. Adding a target type means adding an adapter and a `case` in `adapterFor`; adding a CI system means adding a `CiProvider` (`githubActions`, `gitlabCi` and `bitbucketPipelines` are exported). `ci()` on an adapter reports what a CI file must provide: the secret names, the registry, and whether the deploy runs `docker`, which decides whether GitLab and Bitbucket jobs get a Docker daemon.
