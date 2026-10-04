import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { detectPackageManager } from "./pm.js";
import type { CliResult } from "./types.js";

export type Level = "ok" | "warn" | "fail";

export interface Finding {
  level: Level;
  message: string;
  /** What to do about it. Shown under warnings and failures. */
  hint?: string | undefined;
}

export interface DoctorOptions {
  /** Defaults to this process's Node version. Injected so tests don't depend on the machine. */
  nodeVersion?: string | undefined;
}

const MIN_NODE_MAJOR = 24;

/** Removes `//` and block comments and trailing commas, so a tsconfig (JSONC) parses with `JSON.parse`. */
function stripJsonc(text: string): string {
  let out = "";
  let inString = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? "";
    const next = text[index + 1];
    if (inString) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        index++;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
      out += char;
    } else if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") {
        index++;
      }
      out += "\n";
    } else if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        index++;
      }
      index++;
    } else {
      out += char;
    }
  }
  // Trailing commas, outside strings.
  let result = "";
  inString = false;
  for (let index = 0; index < out.length; index++) {
    const char = out[index] ?? "";
    if (inString) {
      result += char;
      if (char === "\\") {
        result += out[index + 1] ?? "";
        index++;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
      result += char;
    } else if (char === ",") {
      const following = /^\s*([}\]])/.exec(out.slice(index + 1));
      if (!following) {
        result += char;
      }
    } else {
      result += char;
    }
  }
  return result;
}

function readJsonc(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(stripJsonc(readFileSync(path, "utf8")));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed)) : undefined;
  } catch {
    return undefined;
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};

interface TsConfig {
  options: Record<string, unknown>;
  /** `extends` entries that aren't relative paths (packages like `@tsconfig/node24`), which aren't followed. */
  unfollowed: string[];
}

/** The merged `compilerOptions` of a tsconfig and everything it extends by relative path. */
function loadTsConfig(path: string, seen = new Set<string>()): TsConfig | undefined {
  const full = resolve(path);
  if (seen.has(full)) {
    return { options: {}, unfollowed: [] };
  }
  seen.add(full);
  const file = readJsonc(full);
  if (!file) {
    return undefined;
  }

  const merged: TsConfig = { options: {}, unfollowed: [] };
  const extendsValue = file["extends"];
  const parents = typeof extendsValue === "string" ? [extendsValue] : Array.isArray(extendsValue) ? extendsValue.filter((item): item is string => typeof item === "string") : [];
  for (const parent of parents) {
    if (!parent.startsWith(".")) {
      merged.unfollowed.push(parent);
      continue;
    }
    const target = resolve(dirname(full), parent.endsWith(".json") ? parent : `${parent}.json`);
    const loaded = loadTsConfig(target, seen);
    if (loaded) {
      Object.assign(merged.options, loaded.options);
      merged.unfollowed.push(...loaded.unfollowed);
    }
  }
  Object.assign(merged.options, asRecord(file["compilerOptions"]));
  return merged;
}

/** The year of an ECMAScript `target` (`es2023` -> 2023, `esnext` -> far future), or undefined when unset. */
function targetYear(target: unknown): number | undefined {
  if (typeof target !== "string") {
    return undefined;
  }
  const value = target.toLowerCase();
  if (value === "esnext") {
    return 9999;
  }
  const match = /^es(\d+)$/.exec(value);
  if (!match?.[1]) {
    return undefined;
  }
  const number = Number(match[1]);
  return number < 100 ? 2009 + number : number;
}

function checkTsConfig(cwd: string): Finding[] {
  const path = join(cwd, "tsconfig.json");
  if (!existsSync(path)) {
    return [{ level: "warn", message: "no tsconfig.json here", hint: "Blixis needs experimentalDecorators and emitDecoratorMetadata; see the Installation page." }];
  }
  const config = loadTsConfig(path);
  if (!config) {
    return [{ level: "warn", message: "tsconfig.json could not be parsed", hint: "Fix the syntax error, then run blix doctor again." }];
  }

  const findings: Finding[] = [];
  const maybeInherited = config.unfollowed.length > 0 ? ` (it extends ${config.unfollowed.join(", ")}, which blix doctor doesn't read; the flag may come from there)` : "";
  const required: [string, string][] = [
    ["experimentalDecorators", "Blixis uses legacy decorators."],
    ["emitDecoratorMetadata", "without it constructor injection can't see parameter types (NotInjectableError)."],
  ];
  for (const [flag, why] of required) {
    if (config.options[flag] === true) {
      findings.push({ level: "ok", message: `tsconfig: ${flag} is on` });
    } else {
      findings.push({
        level: config.unfollowed.length > 0 ? "warn" : "fail",
        message: `tsconfig: ${flag} is not set to true${maybeInherited}`,
        hint: `Set "${flag}": true in compilerOptions: ${why}`,
      });
    }
  }

  const explicit = config.options["useDefineForClassFields"];
  const year = targetYear(config.options["target"]);
  const effective = typeof explicit === "boolean" ? explicit : year !== undefined && year >= 2022;
  if (effective) {
    findings.push({
      level: "fail",
      message: typeof explicit === "boolean" ? "tsconfig: useDefineForClassFields is true" : `tsconfig: useDefineForClassFields defaults to true for target ${String(config.options["target"])}`,
      hint: 'Set "useDefineForClassFields": false: legacy decorators expect the older class-field semantics, and field initialisation order breaks otherwise.',
    });
  } else {
    findings.push({ level: "ok", message: "tsconfig: useDefineForClassFields is off" });
  }
  return findings;
}

/**
 * Every physical copy of `@blixis-io/core` and `@blixis-io/di` that something installed can actually resolve: the
 * project's `node_modules` entries, then each package's own nested `node_modules` and, for pnpm, the sibling entries
 * next to it in the virtual store. Folders nothing links to (leftovers in `.pnpm` after a dependency change) don't
 * count, which is what `pnpm why` reports too. Keyed by real path, so a symlinked copy is counted once.
 */
function findCopies(cwd: string, names: readonly string[]): Map<string, { version: string; path: string }[]> {
  const wanted = new Set(names.map((name) => `@blixis-io/${name}`));
  const copies = new Map<string, { version: string; path: string }[]>(names.map((name) => [name, []]));
  const seenPackages = new Set<string>();
  const seenDirectories = new Set<string>();

  const scan = (directory: string): void => {
    if (seenDirectories.has(directory) || !existsSync(directory)) {
      return;
    }
    seenDirectories.add(directory);
    for (const entry of readdirSync(directory)) {
      if (entry.startsWith(".")) {
        continue;
      }
      const packages = entry.startsWith("@") ? readdirSync(join(directory, entry)).map((child) => join(directory, entry, child)) : [join(directory, entry)];
      for (const candidate of packages) {
        visit(candidate);
      }
    }
  };

  const visit = (candidate: string): void => {
    if (!existsSync(join(candidate, "package.json"))) {
      return;
    }
    const real = realpathSync(candidate);
    if (seenPackages.has(real)) {
      return;
    }
    seenPackages.add(real);
    const manifest = readJsonc(join(real, "package.json"));
    const name = manifest?.["name"];
    if (typeof name === "string" && wanted.has(name)) {
      copies.get(name.slice("@blixis-io/".length))?.push({ version: typeof manifest?.["version"] === "string" ? manifest["version"] : "unknown", path: real });
    }
    scan(join(real, "node_modules"));
    // pnpm: a package's dependencies are its siblings, `.pnpm/<id>/node_modules/<dep>`.
    const container = dirname(real);
    const siblings = basename(container).startsWith("@") ? dirname(container) : container;
    if (basename(siblings) === "node_modules") {
      scan(siblings);
    }
  };

  scan(join(cwd, "node_modules"));
  return copies;
}

function checkDuplicates(cwd: string): Finding[] {
  const findings: Finding[] = [];
  const found = findCopies(cwd, ["core", "di"]);
  for (const [name, copies] of found) {
    if (copies.length > 1) {
      findings.push({
        level: "fail",
        message: `${copies.length} copies of @blixis-io/${name} are installed: ${copies.map((copy) => copy.version).toSorted().join(", ")}`,
        hint: `Two copies each get their own DI metadata, so a module from one is invisible to the other (NotAModuleError). Upgrade every @blixis-io/* package together (e.g. pnpm update "@blixis-io/*" --latest) and reinstall, then check \`pnpm why @blixis-io/${name}\`.`,
      });
    } else if (copies.length === 1) {
      findings.push({ level: "ok", message: `a single copy of @blixis-io/${name} (${copies[0]?.version ?? "unknown"})` });
    }
  }
  return findings;
}

function installedVersion(cwd: string, name: string): string | undefined {
  const manifest = readJsonc(join(cwd, "node_modules", name, "package.json"));
  return typeof manifest?.["version"] === "string" ? manifest["version"] : undefined;
}

const RISKY_TOOLS = /\b(tsx|ts-node|esbuild)\b/;
const VITEST_CONFIGS = ["vitest.config.ts", "vitest.config.mts", "vitest.config.js", "vitest.config.mjs", "vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"];

export function diagnose(cwd: string, options: DoctorOptions = {}): Finding[] {
  const findings: Finding[] = [];

  const node = options.nodeVersion ?? process.versions.node;
  const major = Number(node.split(".")[0]);
  findings.push(
    major >= MIN_NODE_MAJOR
      ? { level: "ok", message: `node ${node}` }
      : { level: "fail", message: `node ${node} is older than ${MIN_NODE_MAJOR}`, hint: `Blixis needs Node ${MIN_NODE_MAJOR} or newer (engines >=${MIN_NODE_MAJOR}).` },
  );

  const manifest = readJsonc(join(cwd, "package.json"));
  if (!manifest) {
    findings.push({ level: "fail", message: "no readable package.json here", hint: "Run blix doctor from your project's root." });
    return findings;
  }

  const dependencies = { ...asRecord(manifest["dependencies"]), ...asRecord(manifest["devDependencies"]), ...asRecord(manifest["peerDependencies"]) };
  const blixis = Object.keys(dependencies).filter((name) => name.startsWith("@blixis-io/")).toSorted();
  if (blixis.length > 0) {
    const versions = blixis.map((name) => `${name.slice("@blixis-io/".length)} ${installedVersion(cwd, name) ?? "(not installed)"}`);
    findings.push({
      level: versions.some((entry) => entry.endsWith("(not installed)")) ? "warn" : "ok",
      message: `@blixis-io: ${versions.join(", ")}`,
      hint: versions.some((entry) => entry.endsWith("(not installed)")) ? "Some packages are listed but not installed: run your package manager's install." : undefined,
    });
  }

  findings.push(...checkTsConfig(cwd));
  findings.push(...checkDuplicates(cwd));

  if (detectPackageManager(cwd) === "pnpm" && typeof manifest["packageManager"] !== "string") {
    findings.push({
      level: "warn",
      message: 'package.json has no "packageManager" field',
      hint: "Without it, corepack (Docker builds, CI) installs whichever pnpm is newest, which may not be yours. Pin it with: corepack use pnpm@latest",
    });
  } else if (typeof manifest["packageManager"] === "string") {
    findings.push({ level: "ok", message: `packageManager pinned (${manifest["packageManager"]})` });
  }

  const risky = new Set<string>();
  for (const [script, command] of Object.entries(asRecord(manifest["scripts"]))) {
    const match = typeof command === "string" ? RISKY_TOOLS.exec(command) : null;
    if (match?.[1]) {
      risky.add(`script "${script}" runs ${match[1]}`);
    }
  }
  for (const tool of ["tsx", "ts-node", "esbuild"]) {
    if (tool in dependencies) {
      risky.add(`${tool} is a dependency`);
    }
  }
  if (risky.size > 0) {
    findings.push({
      level: "warn",
      message: `tools that don't emit decorator metadata: ${[...risky].join("; ")}`,
      hint: "esbuild-based tools (tsx, esbuild, ts-node's swc/esbuild modes) drop emitDecoratorMetadata, so constructor injection breaks if they compile your app. Build with tsc (or Rolldown) and run the output. Fine if they only run things that don't use DI.",
    });
  }

  if ("vitest" in dependencies) {
    const config = VITEST_CONFIGS.find((file) => existsSync(join(cwd, file)));
    const text = config ? readFileSync(join(cwd, config), "utf8") : "";
    findings.push(
      text.includes("emitDecoratorMetadata")
        ? { level: "ok", message: `vitest: decorator metadata configured in ${config ?? ""}` }
        : {
            level: "warn",
            message: config ? `vitest: ${config} doesn't enable decorator metadata` : "vitest: no config file found",
            hint: "Vitest transforms TypeScript with Oxc, which doesn't read tsconfig: set oxc.decorator.legacy and oxc.decorator.emitDecoratorMetadata to true in your Vitest config, or DI tests fail with NotInjectableError.",
          },
    );
  }

  return findings;
}

const LABEL: Record<Level, string> = { ok: "ok  ", warn: "warn", fail: "FAIL" };

export function runDoctor(cwd: string, options: DoctorOptions = {}): CliResult {
  const findings = diagnose(cwd, options);
  const lines = findings.flatMap((finding) => [`${LABEL[finding.level]}  ${finding.message}`, ...(finding.hint ? [`      ${finding.hint}`] : [])]);

  const failures = findings.filter((finding) => finding.level === "fail").length;
  const warnings = findings.filter((finding) => finding.level === "warn").length;
  lines.push("", failures === 0 && warnings === 0 ? "Everything looks right." : `${failures} problem${failures === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}.`);
  return { exitCode: failures > 0 ? 1 : 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}
