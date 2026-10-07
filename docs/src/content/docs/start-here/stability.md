---
title: Stability and Support
description: Who Blixis is for, what is supported, how versions work before 1.0, how to upgrade, and what 1.0 will require.
sidebar:
  order: 4
---

Blixis is **pre-1.0**. Every package is `0.x`, released continuously, and a minor release can change behaviour. This page says what that means in practice, so you can decide how much upgrade risk to take.

## Who it is for

- **Teams building API-first backends in TypeScript** who like NestJS's structure (modules, decorators, constructor injection) and want a framework small enough to read: the container is a few hundred lines, the HTTP layer sits on the Web-standard `Request` and `Response`, and errors name the fix.
- **Multi-tenant SaaS** is the use the extra packages are shaped for: Zod-validated config, Postgres through Drizzle, JWT sign-in with refresh rotation, request-scoped tenancy, OpenAPI from your controllers.

It is not a fit if you need: an ecosystem of plugins, a runtime other than Node 24+ (see [Compatibility](/framework/architecture/compatibility/)), TC39 standard decorators (legacy `experimentalDecorators` are required, and [why](/framework/architecture/why-legacy-decorators/)), or an API that will not move. Read [Compatibility](/framework/architecture/compatibility/) before relying on something it marks *Not tested*.

## What is supported

- **Node 24 and newer** (`@blixis-io/auth` needs 24.7 for the built-in Argon2). CI runs Node 24 (required) and the latest Node (tracked).
- **The latest version of each `@blixis-io/*` package.** There are no long-term-support branches and no backports: fix by upgrading. Security fixes follow the same rule; see the [security policy](https://github.com/blixis-io/framework/blob/main/SECURITY.md) for how to report one.
- **One copy of each package in your app.** Packages that extend the framework (`http`, `auth`, `openapi`, ...) declare `@blixis-io/core`, `@blixis-io/di`, `@blixis-io/http`, `zod` and `drizzle-orm` as **peer dependencies**, so your app installs them once and they are shared. A second copy breaks decorator metadata and module identity; the framework refuses it at import with a message, and `blix doctor` looks for it.

## How versions work before 1.0

Each package is versioned on its own with [Changesets](https://github.com/changesets/changesets), following SemVer's `0.x` convention:

| Release | What it may contain |
| --- | --- |
| **patch** (`0.8.0` to `0.8.1`) | Bug fixes, and changes in behaviour that make the documented behaviour true. No new API you must adopt. |
| **minor** (`0.8.x` to `0.9.0`) | New features, **and** breaking changes. |
| `1.0.0` | Not yet. See the checklist below. |

Rules the project follows so a `0.x` minor is not a surprise:

- **Every behaviour change is written down.** The changelog entry (`CHANGELOG.md` in each package, and the release pull request) says what changed, what it was before, and, when a request or an app that worked before can behave differently, says so in a sentence starting "Behaviour change". Read the entries for the packages you use before upgrading; they are written for that.
- **A bug fix can still change what your app does.** If your app depended on the buggy behaviour (a `405` that is now a handler call, a request that used to hang and now times out), it will notice. These are called out as above, not hidden.
- **A breaking change to a package bumps its minor**, and dependents get a bumped peer range, so a package manager refuses a mismatched set (npm with `ERESOLVE`; pnpm only warns, so run `blix doctor`).
- **Upgrade the `@blixis-io/*` packages together**, then run your tests. Within 24 hours of a release pnpm 11 may refuse the new versions; see [Installation](/framework/start-here/installation/#pnpm-11-skips-versions-younger-than-24-hours).

## Deprecation

When something is going to be removed, it is marked `@deprecated` in the code (your editor shows it), named in the changelog with what to use instead, and kept for **at least one minor release** before it is removed. There are no deprecated APIs today. A security fix can remove something immediately, and says so.

## Where the guarantees are strongest

Behaviour that has a test and a document describing it is what the project tries not to break: the [request path](/framework/concepts/request-path/), [lifecycle hooks](/framework/concepts/lifecycle-hooks/), the [tenancy](/framework/concepts/tenancy/) and [authentication](/framework/concepts/authentication/) rules. Where the docs say a limit (`requestTimeout` does not cancel work, the in-process event bus does not survive a crash, the grace window is off by default), that is the contract too. If the docs and the behaviour disagree, that is a bug, and which of the two is wrong gets decided in the issue.

## What 1.0 will require

`1.0.0` means the public API is committed to and breaking changes need a major. It will not happen until:

- [ ] every package's public exports are checked automatically (`publint` and `attw` run on every pull request; a snapshot of the export list, which is what would catch a removed export, does not exist yet), so a breaking change cannot ship by accident;
- [x] a scaffolded app is installed from the packed packages, built, started, probed and stopped in CI on Linux, macOS and Windows, with pnpm and npm (the same check also runs weekly against what is published on npm);
- [x] a complete multi-tenant reference application is maintained (`examples/saas-api`), with its upgrade path tested: a pull request builds and tests the app as it was at the last release against the packages it would publish next (not a required check, since a deliberate breaking change fails it until the next release);
- [ ] `blix doctor` reports unmet peer ranges (pnpm only warns about them today);
- [ ] there is a stated position on standard decorators and the legacy-decorator requirement;
- [x] the production baseline exists and is documented: security headers, CORS, rate limiting, health and readiness (see [Running in Production](/framework/guides/running-in-production/) and [Securing the API](/framework/guides/securing-the-api/));
- [ ] at least one outside application has run on it in production and reported what hurt.

## Contributing

See [`CONTRIBUTING.md`](https://github.com/blixis-io/framework/blob/main/CONTRIBUTING.md).
