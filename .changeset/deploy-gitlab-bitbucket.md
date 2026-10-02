---
"@blixis-io/deploy": minor
---

GitLab CI and Bitbucket Pipelines generators: `blix deploy init --ci gitlab|bitbucket` and `blix deploy ci gitlab|bitbucket` write `.gitlab-ci.yml` or `bitbucket-pipelines.yml`. One job in a plain `node` image: install with your package manager (`corepack enable` first for pnpm and yarn), then `blix deploy <target>`. Docker targets get a Docker daemon (GitLab's `docker:27-dind` service plus the client; Bitbucket's `docker` service, with the client installed only if missing); Vercel and Netlify jobs get none. A comment at the top of each file lists the CI/CD variables to set, and on `registry.gitlab.com` the credentials come from GitLab's own variables. Adapters now report whether the deploy runs Docker (`ci().docker`).
