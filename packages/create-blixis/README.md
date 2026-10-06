# `create-blixis`

Scaffold a new [Blixis](https://github.com/blixis-io/framework) app.

```bash
pnpm create blixis my-app
npm create blixis@latest my-app
yarn create blixis my-app
bun create blixis my-app
```

Writes a runnable starter (service, controller, module, `main.ts`, `tsconfig.json` with the decorator settings Blixis needs), then installs `@blixis-io/core`, `@blixis-io/di`, `@blixis-io/http`, `typescript` and `@types/node` with whichever package manager invoked it.

```bash
cd my-app
pnpm dev      # rebuilds and restarts on every change
# or: pnpm build && pnpm start
curl http://localhost:3000/hello/world   # {"message":"Hello, world!"}
```

| Option | |
|---|---|
| `--deploy <target>` | also set up deployment: `docker`, `vercel`, `netlify` or `cloudflare`. Installs `@blixis-io/cli` and `@blixis-io/deploy` and runs `blix deploy init` |
| `--ci <provider>` | with `--deploy`: also write the pipeline (`github`, `gitlab` or `bitbucket`) |
| `--no-install` | write the files only and print the install commands (with `--deploy`, including the deploy ones) |

The target directory must not exist or must be empty. Nested paths work (`apps/api`); the package is named after the last segment. No `@blixis-io/*` runtime dependency.

Part of [Blixis Framework](https://github.com/blixis-io/framework) — [Installation](https://blixis-io.github.io/framework/start-here/installation/) · [Quickstart](https://blixis-io.github.io/framework/start-here/quickstart/).
