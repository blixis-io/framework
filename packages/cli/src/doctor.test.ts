import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diagnose, runDoctor } from "./doctor.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "blix-doctor-test-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function write(path: string, content: string | object): void {
  const full = join(cwd, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content));
}

const GOOD_TSCONFIG = { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, useDefineForClassFields: false } };

function levels(findings: ReturnType<typeof diagnose>, match: string): string[] {
  return findings.filter((finding) => finding.message.includes(match)).map((finding) => finding.level);
}

/** A pnpm-style install: the real package in the virtual store, symlinked from `from` (relative to the project). */
function pnpmPackage(name: string, version: string, from: string): void {
  const store = `node_modules/.pnpm/@blixis-io+${name}@${version}/node_modules/@blixis-io/${name}`;
  write(`${store}/package.json`, { name: `@blixis-io/${name}`, version });
  mkdirSync(dirname(join(cwd, from)), { recursive: true });
  symlinkSync(join(cwd, store), join(cwd, from));
}

describe("blix doctor", () => {
  it("passes a correctly configured project", () => {
    write("package.json", { packageManager: "pnpm@11.0.0", dependencies: { "@blixis-io/core": "^0.3.0" } });
    write("pnpm-lock.yaml", "");
    write("tsconfig.json", GOOD_TSCONFIG);
    write("node_modules/@blixis-io/core/package.json", { version: "0.3.0" });

    const result = runDoctor(cwd, { nodeVersion: "24.1.0" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Everything looks right.");
    expect(result.stdout).toContain("core 0.3.0");
  });

  it("fails on an old Node", () => {
    write("package.json", {});
    write("tsconfig.json", GOOD_TSCONFIG);
    const result = runDoctor(cwd, { nodeVersion: "20.11.0" });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("node 20.11.0 is older than 24");
  });

  it("fails when the decorator flags are missing", () => {
    write("package.json", {});
    write("tsconfig.json", { compilerOptions: {} });
    const findings = diagnose(cwd, { nodeVersion: "24.0.0" });
    expect(levels(findings, "experimentalDecorators")).toEqual(["fail"]);
    expect(levels(findings, "emitDecoratorMetadata")).toEqual(["fail"]);
  });

  it("reads tsconfig comments and trailing commas", () => {
    write("package.json", {});
    write(
      "tsconfig.json",
      `{
  // legacy decorators
  "compilerOptions": {
    "experimentalDecorators": true, /* needed */
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "paths": { "x": ["a//b"] },
  },
}`,
    );
    const findings = diagnose(cwd, { nodeVersion: "24.0.0" });
    expect(findings.filter((finding) => finding.level === "fail")).toEqual([]);
  });

  it("follows relative extends and lets the child override", () => {
    write("package.json", {});
    write("tsconfig.base.json", GOOD_TSCONFIG);
    write("tsconfig.json", { extends: "./tsconfig.base", compilerOptions: { emitDecoratorMetadata: false } });
    const findings = diagnose(cwd, { nodeVersion: "24.0.0" });
    expect(levels(findings, "experimentalDecorators")).toEqual(["ok"]);
    expect(levels(findings, "emitDecoratorMetadata")).toEqual(["fail"]);
  });

  it("downgrades to a warning when a flag may come from a package extends", () => {
    write("package.json", {});
    write("tsconfig.json", { extends: "@tsconfig/node24/tsconfig.json", compilerOptions: {} });
    const findings = diagnose(cwd, { nodeVersion: "24.0.0" });
    expect(levels(findings, "experimentalDecorators")).toEqual(["warn"]);
  });

  it("flags useDefineForClassFields, explicit or implied by the target", () => {
    write("package.json", {});
    write("tsconfig.json", { compilerOptions: { ...GOOD_TSCONFIG.compilerOptions, useDefineForClassFields: true } });
    expect(levels(diagnose(cwd, { nodeVersion: "24.0.0" }), "useDefineForClassFields")).toEqual(["fail"]);

    write("tsconfig.json", { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, target: "ES2022" } });
    expect(levels(diagnose(cwd, { nodeVersion: "24.0.0" }), "useDefineForClassFields")).toEqual(["fail"]);

    write("tsconfig.json", { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, target: "ES2020" } });
    expect(levels(diagnose(cwd, { nodeVersion: "24.0.0" }), "useDefineForClassFields")).toEqual(["ok"]);
  });

  it("warns about a missing tsconfig and fails on a missing package.json", () => {
    expect(levels(diagnose(cwd, { nodeVersion: "24.0.0" }), "no readable package.json")).toEqual(["fail"]);
    write("package.json", {});
    expect(levels(diagnose(cwd, { nodeVersion: "24.0.0" }), "no tsconfig.json")).toEqual(["warn"]);
  });

  it("detects two physical copies of core, including a nested one", () => {
    write("package.json", { dependencies: { "@blixis-io/core": "^0.3.0" } });
    write("tsconfig.json", GOOD_TSCONFIG);
    write("node_modules/@blixis-io/core/package.json", { name: "@blixis-io/core", version: "0.3.0" });
    write("node_modules/@blixis-io/http/package.json", { name: "@blixis-io/http", version: "0.3.0" });
    write("node_modules/@blixis-io/http/node_modules/@blixis-io/core/package.json", { name: "@blixis-io/core", version: "0.2.0" });

    const result = runDoctor(cwd, { nodeVersion: "24.0.0" });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("2 copies of @blixis-io/core are installed: 0.2.0, 0.3.0");
  });

  it("detects two linked versions in the pnpm virtual store, and counts one symlinked copy once", () => {
    write("package.json", {});
    write("tsconfig.json", GOOD_TSCONFIG);
    pnpmPackage("di", "0.1.0", "node_modules/@blixis-io/di");
    expect(runDoctor(cwd, { nodeVersion: "24.0.0" }).stdout).toContain("a single copy of @blixis-io/di (0.1.0)");

    // A second package whose own dependency resolves to another version: both are reachable.
    pnpmPackage("http", "0.1.0", "node_modules/@blixis-io/http");
    const httpStore = join(cwd, "node_modules/.pnpm/@blixis-io+http@0.1.0/node_modules/@blixis-io");
    write("node_modules/.pnpm/@blixis-io+di@0.1.1/node_modules/@blixis-io/di/package.json", { name: "@blixis-io/di", version: "0.1.1" });
    symlinkSync(join(cwd, "node_modules/.pnpm/@blixis-io+di@0.1.1/node_modules/@blixis-io/di"), join(httpStore, "di"));

    const result = runDoctor(cwd, { nodeVersion: "24.0.0" });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("2 copies of @blixis-io/di are installed: 0.1.0, 0.1.1");
  });

  it("ignores obsolete virtual-store folders that nothing links to", () => {
    write("package.json", {});
    write("tsconfig.json", GOOD_TSCONFIG);
    pnpmPackage("core", "0.4.0", "node_modules/@blixis-io/core");
    // Left behind after an upgrade: still on disk, referenced by nothing.
    write("node_modules/.pnpm/@blixis-io+core@0.3.0/node_modules/@blixis-io/core/package.json", { name: "@blixis-io/core", version: "0.3.0" });

    const result = runDoctor(cwd, { nodeVersion: "24.0.0" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("a single copy of @blixis-io/core (0.4.0)");
  });

  it("warns about a missing packageManager pin under pnpm only", () => {
    write("package.json", {});
    write("tsconfig.json", GOOD_TSCONFIG);
    write("pnpm-lock.yaml", "");
    expect(levels(diagnose(cwd, { nodeVersion: "24.0.0" }), "packageManager")).toEqual(["warn"]);

    write("package.json", { packageManager: "pnpm@11.0.0" });
    expect(levels(diagnose(cwd, { nodeVersion: "24.0.0" }), "packageManager")).toEqual(["ok"]);
  });

  it("warns about tools that drop decorator metadata, in scripts and dependencies", () => {
    write("package.json", { scripts: { dev: "tsx watch src/main.ts" }, devDependencies: { esbuild: "^0.25.0" } });
    write("tsconfig.json", GOOD_TSCONFIG);
    const message = diagnose(cwd, { nodeVersion: "24.0.0" }).find((finding) => finding.message.startsWith("tools that"))?.message;
    expect(message).toContain('script "dev" runs tsx');
    expect(message).toContain("esbuild is a dependency");
  });

  it("checks the Vitest config for decorator metadata", () => {
    write("package.json", { devDependencies: { vitest: "^5.0.0" } });
    write("tsconfig.json", GOOD_TSCONFIG);
    expect(levels(diagnose(cwd, { nodeVersion: "24.0.0" }), "vitest")).toEqual(["warn"]);

    write("vitest.config.ts", "export default { oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } } };");
    expect(levels(diagnose(cwd, { nodeVersion: "24.0.0" }), "vitest")).toEqual(["ok"]);
  });
});
