# `@blixis-io/deploy`

`blix deploy`: build a Blixis app as a Docker image, push it, and optionally run a command so your host picks it up. Runs the same on your machine and in CI.

```bash
pnpm add -D @blixis-io/cli @blixis-io/deploy
blix deploy init --ci github   # blix.config.ts, Dockerfile, .dockerignore, GitHub Actions workflow
blix deploy --dry-run          # print every command, run none
blix deploy                    # log in, build, push, then your `after` command
```

Docker is the only target today; Vercel, Netlify and Cloudflare are planned. Needs `@blixis-io/cli` as a peer dependency.

Part of [Blixis Framework](https://github.com/blixis-io/framework) — [Deploying guide](https://blixis-io.github.io/framework/guides/deploying/) · [Reference](https://blixis-io.github.io/framework/reference/blixis-deploy/).
