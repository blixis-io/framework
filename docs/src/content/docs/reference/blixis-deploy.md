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
blix deploy init [--target docker] [--ci github] [--image <name>] [--branch main] [--entry dist/main.js] [--force]
blix deploy ci <provider> [target] [--branch main] [--force]
blix deploy doctor [target]
```

| Command | |
|---|---|
| `blix deploy [target]` | Runs the full plan: log in, build, push, then the `after` command. Without a target: `deploy.default`, else the only target. |
| `build` | Only builds. Needs no credentials. |
| `init` | Writes `blix.config.ts`, `Dockerfile`, `.dockerignore`, and optionally a CI file. Never overwrites without `--force`. |
| `ci` | (Re)generates the CI file for a configured target. Providers: `github`. |
| `doctor` | Checks config, git, Docker, and which required variables are set. Exits `1` only if Docker is missing or the config is invalid. |

`--dry-run` prints each command as `$ ...` and runs nothing. Options accept `--name value` or `--name=value`. Every error exits `1`.

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

A plan is a list of `Step`s (`command`, `args`, optional `env`, `stdinFromEnv`, `shell`). A `Runner` executes them; `processRunner` is the real one, and tests inject a fake. Adding a target type means adding an adapter and a `case` in `adapterFor`; adding a CI system means adding a `CiProvider`.
