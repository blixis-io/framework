# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Report it privately through GitHub:
**Security tab, then "Report a vulnerability"** on [blixis-io/framework](https://github.com/blixis-io/framework/security/advisories/new).
If you can't use that, contact the maintainer at the address in the `author` field of any package's `package.json`.

Include what you found, the package and version, and how to reproduce it (a failing test or a small script is ideal).
You'll get an acknowledgement within a few days. A fix is released as a patch of the affected package, and the
advisory credits you unless you'd rather it didn't.

## What is supported

The framework is pre-1.0 and every package is released continuously. Only the **latest version of each `@blixis-io/*`
package** receives security fixes. Upgrade rather than expecting a backport.

## What is in scope

The published packages: `@blixis-io/core`, `di`, `http`, `auth`, `db`, `config`, `logging`, `events`, `openapi`,
`tenancy`, `testing`, `method-hooks`, `commands`, `cli`, `deploy`, and `create-blixis`. Examples of things we want to
hear about:

- a way to bypass an authentication or authorization check (`auth`, guards, `tenancy`);
- request handling that can be made to crash, hang or use unbounded memory (`http`);
- injection through generated code, configuration or CI files (`cli`, `deploy`, `create-blixis`);
- secrets ending up in logs, errors or generated files;
- a published package that doesn't match this repository, or a release-process weakness.

Out of scope: the documentation site's build toolchain, and issues that need an attacker who already controls your
`blix.config.ts`, your `node_modules`, or your CI secrets (running `blix` runs your own configuration, like any
build tool).

## How releases are protected

Packages are published from CI through npm Trusted Publishing (OIDC), without a long-lived npm token. The workflows
pin every GitHub Action to a commit, Dependabot proposes updates to them and to the dependencies, `pnpm audit` and
CodeQL run on this repository, and the provider CLIs that `blix deploy` runs are pinned by version.
