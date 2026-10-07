// Proves that an app written against the last release still builds and passes its own tests on what this checkout
// would publish next. `examples/saas-api` is taken exactly as it was at the last release (a git ref), every package
// is packed from this checkout and installed in its place with npm, and the app is then type-checked, built and
// tested against a real Postgres. A breaking change to a public API, a changed default or a migration that no longer
// applies fails here, in the pull request that makes it, instead of in someone's upgrade.
//
//   node scripts/upgrade-path.mjs [--from <git-ref>] [--keep]
//
// Needs the repository built (`pnpm run build`), full git history (the default ref is the last "Version Packages"
// commit), Postgres on DATABASE_URL (default: the compose database on :5434) and `tar`.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fail, materialize, packPackages, quiet, run, step } from "./lib/standalone.mjs";

const args = process.argv.slice(2);
const keep = args.includes("--keep");

function previousRelease() {
  const found = quiet("git", ["log", "--grep=^Version Packages", "--format=%H", "-1", "HEAD"]).stdout.trim();
  if (!found) {
    fail("no \"Version Packages\" commit in this history. Fetch full history (`fetch-depth: 0`) or pass --from <git-ref>.");
  }
  return found;
}

const from = args.includes("--from") ? args[args.indexOf("--from") + 1] : previousRelease();
if (!from || quiet("git", ["cat-file", "-e", `${from}^{commit}`]).status !== 0) {
  fail(`${from} is not a commit in this repository`);
}
if (quiet("git", ["cat-file", "-e", `${from}:examples/saas-api/package.json`]).status !== 0) {
  fail(`examples/saas-api does not exist at ${from}, so there is nothing to upgrade from`);
}

// The long path: on Windows `tmpdir()` can be an 8.3 short name, and package managers then see one directory under two names.
const work = mkdtempSync(join(realpathSync.native(tmpdir()), "blixis-upgrade-"));
console.log(`working in ${work}`);

try {
  step(`take examples/saas-api as it was at ${from.slice(0, 9)} (${quiet("git", ["log", "-1", "--format=%cs %s", from]).stdout.trim()})`);
  const archive = join(work, "saas-api.tar");
  run("git", ["archive", "--format=tar", `--output=${archive}`, from, "examples/saas-api"]);
  run("tar", ["-xf", archive, "-C", work]);

  step("pack every public package from this checkout");
  const packed = packPackages(work);

  step("install them in place of the released versions");
  const app = join(work, "app");
  materialize({ source: join(work, "examples", "saas-api"), app, packed });
  run("npm", ["install", "--no-audit", "--no-fund"], { cwd: app });

  step("type-check the old app (tests included) against the new packages");
  run("npx", ["tsc", "-p", "tsconfig.json"], { cwd: app });

  step("build it");
  run("npx", ["tsc", "-p", "tsconfig.build.json"], { cwd: app });

  step("run its own tests against Postgres");
  run("npx", ["vitest", "run"], { cwd: app });

  console.log(`\nOK: saas-api from ${from.slice(0, 9)} builds and passes on ${packed.packages.length} packages packed from this checkout`);
} finally {
  if (keep || process.exitCode) {
    console.log(`\nkept ${work}`);
  } else {
    rmSync(work, { recursive: true, force: true });
  }
}
