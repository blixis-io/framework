---
"@blixis-io/deploy": minor
---

Two changes to what `blix deploy` trusts. Both can make an existing config behave differently, so read this before upgrading.

**Provider CLIs are pinned.** The Vercel, Netlify and Cloudflare targets ran `npx --yes <cli>@latest` with your deploy token in the environment, so a compromised release of any of those CLIs would have run with your credentials the moment it was published. They now default to a pinned version (`vercel` 62.2.0, `netlify-cli` 27.11.0, `wrangler` 4.147.0), `blix deploy init` writes it into `blix.config.ts` so your repository decides when it changes, and `blix deploy doctor` shows the version each target runs and warns about `"latest"`. A target with no `cliVersion` of its own will now run the pinned version instead of whatever is newest; set `cliVersion` to the version you want, or `"latest"` to keep the old behaviour. Each pinned version was checked to exist on npm, not be deprecated and support Node 24, and its command was checked with `--dry-run`; **none was used for a real deployment**, which needs provider accounts.

**Unknown options are errors.** The `deploy` schemas silently dropped keys they didn't know, so a typo left the default in force: `{ type: "docker", pussh: false }` still pushed the image. An unknown option is now an error that names it and suggests the closest valid one (`unknown option "pussh" (did you mean "push"?)`), in the deploy section, in targets and in `registry`. A config that already contains a typo or a key from another tool will now be refused; remove or fix the key.
