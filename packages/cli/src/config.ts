import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** The shape of `blix.config.*`: each plugin owns and validates its own top-level section (e.g. `deploy`). */
export interface BlixConfig {
  [section: string]: unknown;
}

/** Identity helper so a `blix.config.ts` gets type checking and autocomplete without importing anything heavy. */
export function defineConfig<T extends BlixConfig>(config: T): T {
  return config;
}

export interface LoadedConfig {
  path: string;
  config: BlixConfig;
}

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

/** First match wins. TypeScript works because Node 24 strips types natively, so no `tsx`/`esbuild` is involved. */
export const CONFIG_FILES = ["blix.config.ts", "blix.config.mts", "blix.config.js", "blix.config.mjs", "blix.config.json"] as const;

/** A module's `default` export, without trusting the (`any`-typed) result of a dynamic import. */
function defaultExport(module: unknown): unknown {
  return typeof module === "object" && module !== null && "default" in module ? module.default : undefined;
}

function isPlainObject(value: unknown): value is BlixConfig {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Loads `blix.config.*` from `cwd`, or returns `undefined` when there is none. A config that exists but can't be loaded throws `ConfigError`. */
export async function loadConfig(cwd: string): Promise<LoadedConfig | undefined> {
  const file = CONFIG_FILES.find((name) => existsSync(join(cwd, name)));
  if (!file) {
    return undefined;
  }
  const path = join(cwd, file);

  let value: unknown;
  try {
    if (file.endsWith(".json")) {
      value = JSON.parse(readFileSync(path, "utf8"));
    } else {
      const loaded: unknown = await import(pathToFileURL(path).href);
      value = defaultExport(loaded);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Could not load ${file}: ${reason}`);
  }

  if (!isPlainObject(value)) {
    throw new ConfigError(`${file} must default-export an object, e.g. export default defineConfig({ ... }).`);
  }
  return { path, config: value };
}
