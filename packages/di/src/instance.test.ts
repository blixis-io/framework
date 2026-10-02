import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertSingleInstance, DuplicatePackageError, packageVersion } from "./instance.js";

let root: string;
let counter = 0;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "blix-instance-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A fake installed copy of a package: `<dir>/package.json` plus `<dir>/dist/index.js`. Returns the URL of that module. */
function copy(version: string | undefined, dir = `copy-${++counter}`): string {
  mkdirSync(join(root, dir, "dist"), { recursive: true });
  writeFileSync(join(root, dir, "package.json"), JSON.stringify(version === undefined ? { name: "x" } : { name: "x", version }));
  const file = join(root, dir, "dist", "index.js");
  writeFileSync(file, "");
  return pathToFileURL(file).href;
}

const uniqueName = () => `@blixis-io/test-package-${++counter}-${Date.now()}`;

describe("packageVersion", () => {
  it("reads the version from the package.json above the module", () => {
    expect(packageVersion(copy("1.2.3"))).toBe("1.2.3");
  });

  it('says "unknown" when there is no version', () => {
    expect(packageVersion(copy(undefined))).toBe("unknown");
  });

  it('says "unknown" instead of throwing when there is no URL or no package.json (bundled code)', () => {
    expect(packageVersion(undefined)).toBe("unknown");
    // A module whose directory has no package.json beside it, as in a single-file bundle.
    const bundled = pathToFileURL(join(root, "bundle", "dist", "bundle.js")).href;
    mkdirSync(join(root, "bundle", "dist"), { recursive: true });
    writeFileSync(join(root, "bundle", "dist", "bundle.js"), "");
    expect(packageVersion(bundled)).toBe("unknown");
  });
});

describe("assertSingleInstance never stops a bundled app from starting", () => {
  it("does nothing when the runtime gives modules no URL (Cloudflare Workers)", () => {
    const name = uniqueName();

    expect(() => {
      assertSingleInstance(name, undefined);
      assertSingleInstance(name, undefined);
    }).not.toThrow();
  });

  it("does not throw when package.json can't be read, and still detects a duplicate by location", () => {
    const name = uniqueName();
    const first = pathToFileURL(join(root, "bundle-a", "dist", "x.js")).href;
    const second = pathToFileURL(join(root, "bundle-b", "dist", "x.js")).href;

    expect(() => {
      assertSingleInstance(name, first);
    }).not.toThrow();
    expect(() => {
      assertSingleInstance(name, second);
    }).toThrow("unknown");
  });
});

describe("assertSingleInstance", () => {
  it("accepts the first copy", () => {
    expect(() => {
      assertSingleInstance(uniqueName(), copy("1.0.0"));
    }).not.toThrow();
  });

  it("accepts the same module being evaluated again (same location)", () => {
    const name = uniqueName();
    const url = copy("1.0.0");

    assertSingleInstance(name, url);

    expect(() => {
      assertSingleInstance(name, url);
    }).not.toThrow();
  });

  it("accepts different packages side by side", () => {
    expect(() => {
      assertSingleInstance(uniqueName(), copy("1.0.0"));
      assertSingleInstance(uniqueName(), copy("1.0.0"));
    }).not.toThrow();
  });

  it("throws DuplicatePackageError when a different copy of the same package is loaded", () => {
    const name = uniqueName();
    assertSingleInstance(name, copy("0.1.0"));

    expect(() => {
      assertSingleInstance(name, copy("0.2.0"));
    }).toThrow(DuplicatePackageError);
  });

  it("names both versions and both locations, and says what to do", () => {
    const name = uniqueName();
    const first = copy("0.1.0");
    const second = copy("0.2.0");
    assertSingleInstance(name, first);

    let message = "";
    try {
      assertSingleInstance(name, second);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toContain(`Two copies of ${name} are loaded`);
    expect(message).toContain(`0.1.0  ${first}`);
    expect(message).toContain(`0.2.0  ${second}`);
    expect(message).toContain(`pnpm why ${name}`);
  });

  it("catches two copies of the SAME version too (the usual cause is a duplicated install)", () => {
    const name = uniqueName();
    assertSingleInstance(name, copy("0.2.0"));

    expect(() => {
      assertSingleInstance(name, copy("0.2.0"));
    }).toThrow("Two copies");
  });
});
