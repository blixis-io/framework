---
"create-blixis": patch
---

The scaffolded `package.json` now pins `packageManager` (e.g. `pnpm@11.25.0`) to the package manager that ran `create`, so a Docker image or CI job installs with the same major version instead of whichever corepack picks. Found while testing `blix deploy`: an unpinned project got pnpm 12 in its image.
