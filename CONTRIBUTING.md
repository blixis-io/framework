# Contributing

Thanks for looking. This is a small project with strong opinions about evidence, so the process below is mostly "show that it works".

## Set up

You need **Node 24+**, **pnpm 11** (`corepack enable`), and **Docker** for the Postgres the `db`, `tenancy` and `auth` tests use.

```bash
pnpm install
docker compose up -d postgres    # port 5434, user/password/database: blixis
pnpm run ci                      # build, typecheck, lint, tests with coverage, format check, docs links
```

`pnpm run ci` is exactly what the CI job runs; if it passes locally the required check should pass. Tests for one package: `cd packages/http && npx vitest run`.

Two more checks run on every pull request but are not required: the fresh-install jobs, and `upgrade-path`, which builds and tests `examples/saas-api` as it was at the last release against packages packed from your branch (`node scripts/upgrade-path.mjs` after `pnpm run build`, with Postgres running). If it fails, your change breaks an app written against the last release: fix it, or say in the pull request that the break is deliberate and put it in the changeset.

## What a good pull request looks like

- **One change per pull request.** A fix and an unrelated cleanup are two pull requests.
- **A fix starts with a test that fails on the old code.** Reproduce the bug first, then fix it; say in the pull request how it was reproduced.
- **A changeset** (`pnpm changeset`) for any change to a published package: a patch for a fix, a minor for a feature or a breaking change. Write it for the person upgrading: what changed, what it was before, and a sentence starting "Behaviour change" if working code could behave differently.
- **Docs in the same pull request**, wherever the behaviour is described: the concept page, the reference, a guide. A documented claim should have a test.
- **Say what you did not verify.** "Not run: a real proxy" is useful; silence is not.
- Commit messages follow the existing history: `feat(http): ...`, `fix(auth): ...`, `docs: ...`, `test(tenancy): ...`, `ci: ...`.

## Conventions

- TypeScript is strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Lint is `oxlint` with type-aware rules; `no-floating-promises` is an error.
- Tests live next to the code (`*.test.ts`) and run on a real Postgres where a database is involved, not a mock. Prefer a real socket or a real application over mocking the unit under test.
- Packages that extend the framework take `core`, `di`, `http`, `zod` and `drizzle-orm` as **peer** dependencies, never regular ones.
- Comments explain *why*, and the docs hold the *what*.

## Releases

Merging a changeset to `main` makes the release workflow open (or update) a "Version Packages" pull request. Merging that publishes to npm through Trusted Publishing; there is no long-lived npm token. Maintainers do this.

## Security

Don't open a public issue for a vulnerability; see [SECURITY.md](SECURITY.md).

## Where things are

| | |
| --- | --- |
| `packages/*` | The published packages. |
| `examples/hello-api` | A runnable example app, used as an end-to-end test. |
| `docs/` | The documentation site (Astro Starlight). |
| `PLAN.md`, `TASKS.md` | The current improvement plan and what is done. |
