---
"@blixis-io/deploy": minor
---

First release. `blix deploy` builds a Docker image, pushes it and runs an optional `after` command; `init` writes `blix.config.ts`, a `Dockerfile`, `.dockerignore` and a GitHub Actions workflow; `build`, `ci`, `doctor` and `--dry-run` round it out. The registry password is piped on stdin and never appears in a command line or output. Targets and CI systems are registries, so Vercel, Netlify, Cloudflare, GitLab CI and Bitbucket Pipelines can be added as adapters.
