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
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const keep = args.includes("--keep");

function fail(message) {
  console.error(`\nFAILED: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function step(message) {
  console.log(`\n=== ${message}`);
}

/** Runs a command to completion, streaming its output, and returns its stdout. */
function run(command, commandArgs, options = {}) {
  console.log(`$ ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    fail(`\`${command} ${commandArgs.join(" ")}\` exited with ${result.status ?? result.signal}`);
  }
  return result.stdout;
}

const quiet = (command, commandArgs) => spawnSync(command, commandArgs, { cwd: root, encoding: "utf8" });

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
  const app = join(work, "app");
  mkdirSync(app);
  const archive = join(work, "saas-api.tar");
  run("git", ["archive", "--format=tar", `--output=${archive}`, from, "examples/saas-api"]);
  run("tar", ["-xf", archive, "-C", work]);
  const old = join(work, "examples", "saas-api");
  for (const entry of ["src", "migrations", "blix.config.ts"]) {
    cpSync(join(old, entry), join(app, entry), { recursive: true });
  }
  const oldManifest = JSON.parse(readFileSync(join(old, "package.json"), "utf8"));

  step("pack every public package from this checkout");
  const packages = readdirSync(join(root, "packages"))
    .map((dir) => ({ dir: join(root, "packages", dir), manifest: join(root, "packages", dir, "package.json") }))
    .filter(({ manifest }) => existsSync(manifest))
    .map(({ dir, manifest }) => ({ dir, ...JSON.parse(readFileSync(manifest, "utf8")) }))
    .filter((pkg) => !pkg.private);
  for (const pkg of packages) {
    if (!existsSync(join(pkg.dir, "dist"))) {
      fail(`${pkg.name} has no dist/. Run \`pnpm run build\` first.`);
    }
  }
  const tarballs = join(work, "tarballs");
  mkdirSync(tarballs);
  for (const pkg of packages) {
    // pnpm pack, not npm pack: it rewrites `workspace:` ranges to real versions, as publishing does.
    run("pnpm", ["pack", "--pack-destination", tarballs], { cwd: pkg.dir });
  }
  const tarball = (pkg) => join(tarballs, `${pkg.name.replace(/^@/, "").replace("/", "-")}-${pkg.version}.tgz`);

  step("install them in place of the released versions");
  const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const tool = (name) => rootManifest.devDependencies?.[name] ?? fail(`${name} is not a devDependency of the root package.json`);
  // Every packed package is a direct dependency, so npm resolves a package's own @blixis-io dependencies to the tarballs
  // and never to the registry's older copies.
  const blixis = Object.fromEntries(packages.map((pkg) => [pkg.name, `file:${tarball(pkg)}`]));
  const external = (deps) => Object.fromEntries(Object.entries(deps ?? {}).filter(([name]) => !name.startsWith("@blixis-io/")));
  writeFileSync(
    join(app, "package.json"),
    JSON.stringify(
      {
        name: "saas-api-upgrade",
        private: true,
        type: "module",
        dependencies: { ...external(oldManifest.dependencies), ...blixis },
        devDependencies: { ...external(oldManifest.devDependencies), typescript: tool("typescript"), vitest: tool("vitest"), "@types/node": tool("@types/node") },
      },
      null,
      2,
    ),
  );
  const base = JSON.parse(readFileSync(join(root, "tsconfig.base.json"), "utf8"));
  writeFileSync(join(app, "tsconfig.json"), JSON.stringify({ compilerOptions: { ...base.compilerOptions, noEmit: true, rootDir: "src" }, include: ["src"] }, null, 2));
  writeFileSync(
    join(app, "tsconfig.build.json"),
    JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { noEmit: false, outDir: "dist" }, exclude: ["src/**/*.test.ts"] }, null, 2),
  );
  // Oxc must be told to emit legacy decorators and design-time metadata, as the repository's shared vitest config does.
  writeFileSync(
    join(app, "vitest.config.ts"),
    'import { defineConfig } from "vitest/config";\nexport default defineConfig({ oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } }, test: { environment: "node", include: ["src/**/*.test.ts"] } });\n',
  );
  run("npm", ["install", "--no-audit", "--no-fund"], { cwd: app });

  step("type-check the old app (tests included) against the new packages");
  run("npx", ["tsc", "-p", "tsconfig.json"], { cwd: app });

  step("build it");
  run("npx", ["tsc", "-p", "tsconfig.build.json"], { cwd: app });

  step("run its own tests against Postgres");
  run("npx", ["vitest", "run"], { cwd: app });

  console.log(`\nOK: saas-api from ${from.slice(0, 9)} builds and passes on ${packages.length} packages packed from this checkout`);
} finally {
  if (keep || process.exitCode) {
    console.log(`\nkept ${work}`);
  } else {
    rmSync(work, { recursive: true, force: true });
  }
}
