import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { templateFiles } from "./template.js";

const PACKAGE_NAME = /^[a-z0-9-~][a-z0-9-._~]*$/;

export class ScaffoldError extends Error {
  override readonly name = "ScaffoldError";
}

export interface ScaffoldResult {
  directory: string;
  packageName: string;
  files: string[];
}

/** Writes the starter app into `cwd/<target>`. The directory may not exist yet, or must be empty. */
export function scaffold(cwd: string, target: string, packageManagerPin?: string): ScaffoldResult {
  const directory = resolve(cwd, target);
  const packageName = basename(directory);

  if (!PACKAGE_NAME.test(packageName)) {
    throw new ScaffoldError(
      `"${packageName}" is not a valid package name — use lowercase letters, digits, "-", "." or "_", starting with a letter or digit.`,
    );
  }
  if (existsSync(directory) && readdirSync(directory).length > 0) {
    throw new ScaffoldError(`${target} already exists and is not empty.`);
  }

  const files = Object.entries(templateFiles(packageName, packageManagerPin));
  for (const [path, content] of files) {
    const absolute = join(directory, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }

  return { directory, packageName, files: files.map(([path]) => path) };
}
