import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";
import { afterEach, describe, expect, it } from "vitest";

const coreDist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
let dir: string;

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("an app bundled into a single file", () => {
  // Regression: the duplicate-copy guard used to read its own package.json at import time. Inside a bundle
  // there is no package.json beside the code (and Cloudflare Workers give modules no URL at all), so every
  // bundled app crashed on start. Needs the built dist, which `pnpm run ci` builds first.
  it.skipIf(!existsSync(coreDist))("starts: the guard never stops a bundle from booting", async () => {
    dir = mkdtempSync(join(tmpdir(), "blix-bundled-"));
    mkdirSync(join(dir, "out"), { recursive: true });
    writeFileSync(
      join(dir, "entry.mjs"),
      `import { createApplication, Module } from ${JSON.stringify(coreDist)};

class AppModule {}
Module({ providers: [] })(AppModule);

const app = await createApplication(AppModule);
console.log("booted");
await app.close();
`,
    );

    const bundle = await rolldown({ input: join(dir, "entry.mjs"), platform: "node", external: [/^node:/] });
    await bundle.write({ file: join(dir, "out", "bundle.mjs"), format: "esm" });

    // Run it from a directory with no node_modules and no package.json anywhere near it.
    const stdout = execFileSync("node", [join(dir, "out", "bundle.mjs")], { cwd: dir, encoding: "utf8" });

    expect(stdout.trim()).toBe("booted");
  }, 60_000);
});
