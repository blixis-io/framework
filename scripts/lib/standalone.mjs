// Shared by the scripts that take `examples/saas-api` out of the monorepo and treat it like a stranger's app: pack
// every public package from this checkout, copy the app's files somewhere else, point its dependencies at the
// tarballs, and give it the tsconfig and vitest config it would have outside this repository.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../..", import.meta.url));

export function fail(message) {
  console.error(`\nFAILED: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

export function step(message) {
  console.log(`\n=== ${message}`);
}

/** Runs a command to completion, streaming its output, and returns `{ status, stdout }`. A non-zero exit fails unless `allowFailure`. */
export function run(command, commandArgs, options = {}) {
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
  if (result.status !== 0 && !options.allowFailure) {
    fail(`\`${command} ${commandArgs.join(" ")}\` exited with ${result.status ?? result.signal}`);
  }
  return { status: result.status, stdout: result.stdout };
}

/** Runs a command without echoing it and without failing; for probing. */
export const quiet = (command, commandArgs) => spawnSync(command, commandArgs, { cwd: root, encoding: "utf8" });

/** The dependencies that are not this repository's own packages. */
const external = (deps) => Object.fromEntries(Object.entries(deps ?? {}).filter(([name]) => !name.startsWith("@blixis-io/")));

/** The file name `pnpm pack` gives a package's tarball. */
const file = (pkg) => `${pkg.name.replace(/^@/, "").replace("/", "-")}-${pkg.version}.tgz`;

/** Packs every public package (the repository must be built) into `<work>/tarballs`. */
export function packPackages(work) {
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
  return { packages, tarballs, file };
}

/**
 * Builds a standalone app in `app` from the files of an example in `source` (a directory holding `package.json`, `src/`,
 * `migrations/`, ...). The packed tarballs are copied into `app/vendor` and every `@blixis-io/*` dependency becomes
 * `file:./vendor/...`, so the app (and a Docker build context) needs nothing outside its own directory. Every packed
 * package is a direct dependency, so npm resolves a package's own @blixis-io dependencies to the tarballs and never to the
 * registry's older copies.
 */
export function materialize({ source, app, packed }) {
  mkdirSync(app, { recursive: true });
  for (const entry of ["src", "migrations", "blix.config.ts", "Dockerfile", ".dockerignore"]) {
    if (existsSync(join(source, entry))) {
      cpSync(join(source, entry), join(app, entry), { recursive: true });
    }
  }
  const vendor = join(app, "vendor");
  mkdirSync(vendor);
  for (const pkg of packed.packages) {
    cpSync(join(packed.tarballs, packed.file(pkg)), join(vendor, packed.file(pkg)));
  }
  const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
  const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const tool = (name) => rootManifest.devDependencies?.[name] ?? fail(`${name} is not a devDependency of the root package.json`);
  writeFileSync(
    join(app, "package.json"),
    JSON.stringify(
      {
        name: manifest.name,
        private: true,
        type: "module",
        scripts: manifest.scripts,
        dependencies: {
          ...external(manifest.dependencies),
          ...Object.fromEntries(packed.packages.map((pkg) => [pkg.name, `file:./vendor/${packed.file(pkg)}`])),
        },
        devDependencies: { ...external(manifest.devDependencies), typescript: tool("typescript"), vitest: tool("vitest"), "@types/node": tool("@types/node") },
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
}
