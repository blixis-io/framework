import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { toKebabCase } from "./names.js";
import { renderTemplate, type GeneratorType } from "./templates.js";

export interface GenerateOptions {
  flat?: boolean;
  force?: boolean;
  dryRun?: boolean;
}

export interface GenerateResult {
  path: string;
  content: string;
  written: boolean;
}

/** `--flat` → `src/<kebab>.<type>.ts`; default → `src/<kebab>/<kebab>.<type>.ts`. */
export function resolveOutputPath(cwd: string, type: GeneratorType, name: string, options: GenerateOptions = {}): string {
  const kebab = toKebabCase(name);
  const fileName = `${kebab}.${type}.ts`;
  return options.flat ? join(cwd, "src", fileName) : join(cwd, "src", kebab, fileName);
}

/**
 * Renders and writes one generated file. Refuses to overwrite an existing
 * file unless `force` is set; `dryRun` renders and resolves the path
 * without writing anything. Creates any missing parent directories.
 */
export function generateFile(cwd: string, type: GeneratorType, name: string, options: GenerateOptions = {}): GenerateResult {
  const path = resolveOutputPath(cwd, type, name, options);
  const content = renderTemplate(type, name);

  if (options.dryRun) {
    return { path, content, written: false };
  }

  if (existsSync(path) && !options.force) {
    throw new Error(`${path} already exists — pass --force to overwrite it`);
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);

  return { path, content, written: true };
}
