/**
 * The GitHub Actions the generated workflow uses, each pinned to the commit its release tag pointed at when this
 * release of `@blixis-io/deploy` was made (the comment names the tag). A tag can be moved by whoever controls the
 * action's repository, and this workflow runs with your deploy secrets, so a commit is what gets trusted.
 *
 * Nothing refreshes them automatically here: they change when this package is released. In your own repository,
 * Dependabot (`package-ecosystem: github-actions`) keeps pinned actions current, and understands the tag comment.
 */
export const ACTION_PINS = {
  checkout: "actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4",
  setupNode: "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6",
  pnpm: "pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4",
  bun: "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2",
} as const;
