import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

/** Which package manager owns this project, judged by the nearest lockfile at or above `cwd` (so a workspace package finds the root's). Defaults to npm. */
export function detectPackageManager(cwd: string): PackageManager {
  let dir = cwd;
  for (;;) {
    const hit = LOCKFILES.find(([file]) => existsSync(join(dir, file)));
    if (hit) {
      return hit[1];
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return "npm";
    }
    dir = parent;
  }
}

/** `add -D <pkg>` in each manager's own spelling. */
export function addDevDependencyArgs(pm: PackageManager, packageName: string): string[] {
  const verb = pm === "npm" ? "install" : "add";
  return [verb, pm === "bun" ? "-d" : "-D", packageName];
}
