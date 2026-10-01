import { createRequire } from "node:module";

/** Thrown when two copies of the same `@blixis-io/*` package are loaded into one process. */
export class DuplicatePackageError extends Error {
  override readonly name = "DuplicatePackageError";
}

interface Loaded {
  version: string;
  location: string;
}

const REGISTRY = Symbol.for("blixis:loaded-packages");

function registry(): Map<string, Loaded> {
  const existing: unknown = Reflect.get(globalThis, REGISTRY);
  if (existing instanceof Map) {
    return existing;
  }
  const created = new Map<string, Loaded>();
  Reflect.set(globalThis, REGISTRY, created);
  return created;
}

/** `version` from the package.json next to a built `dist/` or `src/` module. */
export function packageVersion(moduleUrl: string): string {
  const manifest: unknown = createRequire(moduleUrl)("../package.json");
  return typeof manifest === "object" && manifest !== null && "version" in manifest && typeof manifest.version === "string" ? manifest.version : "unknown";
}

/**
 * Registers this copy of a package on `globalThis` and throws if a *different* copy of it is already there.
 *
 * Two copies means two DI containers with two sets of private metadata keys, so a class decorated by one
 * is invisible to the other and the failure shows up much later as a baffling `NotAModuleError`. This
 * turns it into an error at import time that names both copies. The usual cause is `@blixis-io/http`
 * (or another package) being upgraded without `@blixis-io/core`, or two apps in one workspace pinning
 * different versions.
 */
export function assertSingleInstance(name: string, moduleUrl: string): void {
  const loaded = registry();
  const current: Loaded = { version: packageVersion(moduleUrl), location: moduleUrl };
  const existing = loaded.get(name);

  if (existing && existing.location !== current.location) {
    throw new DuplicatePackageError(
      `Two copies of ${name} are loaded in this process:\n` +
        `  ${existing.version}  ${existing.location}\n` +
        `  ${current.version}  ${current.location}\n` +
        `Each copy has its own DI metadata, so a module or provider defined against one is invisible to the other. ` +
        `Keep every @blixis-io/* package on versions that depend on a single ${name} (check with \`pnpm why ${name}\` or \`npm ls ${name}\`), then reinstall.`,
    );
  }
  loaded.set(name, current);
}
