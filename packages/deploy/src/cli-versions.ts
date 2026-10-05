/**
 * The provider CLI versions `blix deploy` runs by default (`npx --yes <cli>@<version>`), and that `blix deploy init`
 * writes into a new config. They are pinned because the CLI runs with your deploy token in its environment: with
 * `latest`, whatever was published most recently runs with your credentials, the moment it is published.
 *
 * Each version was checked to exist on npm, not be deprecated, and support Node 24 (their `engines`), and the
 * command `blix deploy` builds for it was checked with `--dry-run`. **None of them has been used for a real
 * deployment by this package's tests**, which has no provider accounts. Bump them deliberately, in a release of
 * `@blixis-io/deploy`; users can override per target with `cliVersion`.
 */
export const DEFAULT_CLI_VERSIONS = {
  vercel: "62.2.0",
  "netlify-cli": "27.11.0",
  wrangler: "4.147.0",
} as const;

export type CliPackage = keyof typeof DEFAULT_CLI_VERSIONS;

/** The npm package of the provider CLI each target type runs. */
export const CLI_PACKAGE_FOR_TARGET = { vercel: "vercel", netlify: "netlify-cli", cloudflare: "wrangler" } as const satisfies Record<string, CliPackage>;
