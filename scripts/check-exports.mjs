// Checks what each published package would actually ship: that `package.json` points at files that exist in the
// tarball (`publint`), and that the type declarations resolve the way an ESM consumer and a bundler expect
// (`@arethetypeswrong/cli`). A wrong `exports` entry is invisible inside the monorepo, where the source alias hides
// it, and breaks only for the people who install the package.
//
//   node scripts/check-exports.mjs      (needs the repository built: `pnpm run build`)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const windows = process.platform === "win32";

const packages = readdirSync(join(root, "packages"))
  .map((dir) => join(root, "packages", dir))
  .filter((dir) => existsSync(join(dir, "package.json")))
  .map((dir) => ({ dir, manifest: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) }))
  .filter(({ manifest }) => !manifest.private);

function run(label, command, args, cwd) {
  const result = spawnSync("pnpm", ["exec", command, ...args], { cwd, encoding: "utf8", shell: windows });
  if (result.status !== 0) {
    console.error(`\n${label}: FAILED\n${result.stdout}${result.stderr}`);
    return false;
  }
  console.log(`${label}: ok`);
  return true;
}

let failed = 0;
for (const { dir, manifest } of packages) {
  if (!existsSync(join(dir, "dist"))) {
    console.error(`${manifest.name}: no dist/. Run \`pnpm run build\` first.`);
    failed += 1;
    continue;
  }
  if (!run(`${manifest.name} publint`, "publint", ["--strict", dir], root)) {
    failed += 1;
  }
  // A package with no `types` entry (the CLI binaries) has no declarations to resolve.
  const hasTypes = JSON.stringify(manifest.exports ?? {}).includes('"types"') || manifest.types !== undefined;
  if (hasTypes && !run(`${manifest.name} are-the-types-wrong`, "attw", ["--pack", dir, "--profile", "esm-only"], root)) {
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nOK: ${packages.length} packages.`);
}
