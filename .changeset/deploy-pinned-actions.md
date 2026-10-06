---
"@blixis-io/deploy": patch
---

The generated GitHub Actions workflow pins its actions to a commit instead of a tag. It runs with your deploy secrets, and a tag such as `actions/checkout@v4` can be moved by whoever controls the action's repository, so the file now says `actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4` (likewise `setup-node`, `pnpm/action-setup` and, for bun, `oven-sh/setup-bun`). Regenerate with `blix deploy ci github --force` to pick this up, and add Dependabot's `github-actions` ecosystem to keep the pins current; it understands the tag in the comment. The GitLab and Bitbucket files use container images, not actions, and are unchanged.
