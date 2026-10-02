---
"create-blixis": minor
---

`--deploy <target>` (docker, vercel, netlify or cloudflare) and `--ci <provider>` (github, gitlab or bitbucket) set up deployment as part of scaffolding: after the dependencies are installed it also installs `@blixis-io/cli` and `@blixis-io/deploy` and runs `blix deploy init` in the new project, with the project's own package manager. If that last step fails the app is still created and the message says to run `blix deploy init` yourself. With `--no-install` the deploy commands are printed instead. `--ci` without `--deploy` is rejected before anything is written.
