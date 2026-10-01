import { describe, expect, it } from "vitest";
import { parseDeployConfig, type NetlifyTarget, type VercelTarget } from "./config.js";
import { netlifyEntry } from "./netlify.js";
import { adapterFor, initPlanFor, netlifyAdapter, vercelAdapter } from "./targets.js";
import { fakeRunner } from "./test-helpers.js";
import { vercelEntry } from "./vercel.js";

function targetOf(type: string, extra: Record<string, unknown>) {
  return parseDeployConfig({ path: "p", config: { deploy: { targets: { prod: { type, ...extra } } } } }).targets["prod"];
}

function vercel(extra: Record<string, unknown> = {}): VercelTarget {
  const target = targetOf("vercel", extra);
  if (target?.type !== "vercel") {
    throw new Error("expected a vercel target");
  }
  return target;
}

function netlify(extra: Record<string, unknown> = {}): NetlifyTarget {
  const target = targetOf("netlify", extra);
  if (target?.type !== "netlify") {
    throw new Error("expected a netlify target");
  }
  return target;
}

const ctx = (extra: Record<string, unknown> = {}) => ({ cwd: "/app", env: {}, tag: "abc1234", packageManager: "pnpm" as const, ...extra });
const commands = (steps: { command: string; args: readonly string[] }[]) => steps.map((step) => [step.command, ...step.args].join(" "));

describe("config defaults", () => {
  it("vercel", () => {
    expect(vercel()).toEqual({ type: "vercel", production: true, cliVersion: "latest", env: [] });
  });

  it("netlify", () => {
    expect(netlify()).toEqual({
      type: "netlify",
      production: true,
      cliVersion: "latest",
      env: [],
      dir: "public",
      functions: "netlify/functions",
    });
  });
});

describe("vercelAdapter.plan", () => {
  it("builds the project, then deploys to production", () => {
    const { steps, missingEnv } = vercelAdapter.plan("prod", vercel(), "deploy", ctx());

    expect(commands(steps)).toEqual(["pnpm run build", "npx --yes vercel@latest deploy --yes --prod"]);
    expect(missingEnv).toEqual([]);
  });

  it("a build-only plan is just the build", () => {
    expect(commands(vercelAdapter.plan("prod", vercel(), "build", ctx()).steps)).toEqual(["pnpm run build"]);
  });

  it("production: false deploys a preview, and cliVersion pins the CLI", () => {
    const { steps } = vercelAdapter.plan("prod", vercel({ production: false, cliVersion: "50.1.0" }), "deploy", ctx());

    expect(commands(steps)[1]).toBe("npx --yes vercel@50.1.0 deploy --yes");
  });

  it("uses the project's package manager, or a custom build command through the shell", () => {
    expect(commands(vercelAdapter.plan("p", vercel(), "build", ctx({ packageManager: "npm" })).steps)).toEqual(["npm run build"]);
    const custom = vercelAdapter.plan("p", vercel({ build: "tsc && node scripts/prep.js" }), "build", ctx()).steps[0];

    expect(custom).toMatchObject({ command: "tsc && node scripts/prep.js", shell: true });
  });

  it("requires the variables the target lists, but not VERCEL_TOKEN (a logged-in machine has none)", () => {
    const plan = vercelAdapter.plan("prod", vercel({ env: ["DATABASE_URL"] }), "deploy", ctx());

    expect(plan.missingEnv).toEqual(["DATABASE_URL"]);
  });

  it("CI needs the Vercel credentials plus the target's own variables", () => {
    expect(vercelAdapter.ci(vercel({ env: ["DATABASE_URL"] }))).toEqual({
      secrets: ["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID", "DATABASE_URL"],
    });
  });

  it("labels the deploy with the git commit", async () => {
    const runner = fakeRunner({ captures: { "git rev-parse --short HEAD": { code: 0, stdout: "d34db33\n" } } });

    await expect(vercelAdapter.resolveTag(vercel(), {}, "/app", runner)).resolves.toBe("d34db33");
    await expect(vercelAdapter.resolveTag(vercel(), { BLIX_TAG: "v9" }, "/app", runner)).resolves.toBe("v9");
    await expect(vercelAdapter.resolveTag(vercel(), {}, "/app", fakeRunner())).resolves.toBe("latest");
  });
});

describe("netlifyAdapter.plan", () => {
  it("builds, then deploys the publish dir and functions to production", () => {
    const { steps } = netlifyAdapter.plan("prod", netlify(), "deploy", ctx());

    expect(commands(steps)).toEqual(["pnpm run build", "npx --yes netlify-cli@latest deploy --dir public --functions netlify/functions --prod"]);
  });

  it("passes a configured site, dir and functions directory, and drops --prod for a preview", () => {
    const target = netlify({ site: "abc-123", dir: "static", functions: "fns", production: false });

    expect(commands(netlifyAdapter.plan("prod", target, "deploy", ctx()).steps)[1]).toBe(
      "npx --yes netlify-cli@latest deploy --dir static --functions fns --site abc-123",
    );
  });

  it("CI needs NETLIFY_SITE_ID unless the site is in the config", () => {
    expect(netlifyAdapter.ci(netlify()).secrets).toEqual(["NETLIFY_AUTH_TOKEN", "NETLIFY_SITE_ID"]);
    expect(netlifyAdapter.ci(netlify({ site: "abc", env: ["X"] })).secrets).toEqual(["NETLIFY_AUTH_TOKEN", "X"]);
  });

  it("a build-only plan is just the build; listed variables are required only to deploy", () => {
    const target = netlify({ env: ["API_KEY"] });

    expect(commands(netlifyAdapter.plan("prod", target, "build", ctx()).steps)).toEqual(["pnpm run build"]);
    expect(netlifyAdapter.plan("prod", target, "build", ctx()).missingEnv).toEqual([]);
    expect(netlifyAdapter.plan("prod", target, "deploy", ctx()).missingEnv).toEqual(["API_KEY"]);
  });

  it("labels the deploy with the git commit", async () => {
    const runner = fakeRunner({ captures: { "git rev-parse --short HEAD": { code: 0, stdout: "abc\n" } } });

    await expect(netlifyAdapter.resolveTag(netlify(), {}, "/app", runner)).resolves.toBe("abc");
  });
});

describe("adapterFor binds the new targets", () => {
  it("vercel and netlify", () => {
    expect(commands(adapterFor("prod", vercel()).plan("build", ctx()).steps)).toEqual(["pnpm run build"]);
    expect(adapterFor("prod", netlify()).ci().secrets).toContain("NETLIFY_AUTH_TOKEN");
  });

  it("resolveTag goes through the bound adapter", async () => {
    await expect(adapterFor("prod", vercel()).resolveTag({ BLIX_TAG: "t" }, "/app", fakeRunner())).resolves.toBe("t");
    await expect(adapterFor("prod", netlify()).resolveTag({ BLIX_TAG: "t" }, "/app", fakeRunner())).resolves.toBe("t");
  });
});

describe("function entries (golden)", () => {
  it("vercel", () => {
    expect(vercelEntry("dist/app.module.js", "AppModule")).toBe(`import { createFetchHandler } from "@blixis-io/http";
import { AppModule } from "../dist/app.module.js";

export default createFetchHandler(AppModule);
`);
  });

  it("netlify", () => {
    expect(netlifyEntry("dist/app.module.js", "AppModule")).toBe(`import { createFetchHandler } from "@blixis-io/http";
import { AppModule } from "../../dist/app.module.js";

const handler = createFetchHandler(AppModule);

export default (request) => handler.fetch(request);

export const config = { path: "/*" };
`);
  });
});

const init = (type: "vercel" | "netlify", packageManager: "pnpm" | "npm" = "pnpm") =>
  initPlanFor(type, {
    cwd: "/app",
    packageManager,
    runner: fakeRunner(),
    options: { entry: "dist/main.js", appModule: "dist/app.module.js", appExport: "AppModule" },
  });

describe("initPlanFor", () => {
  it("vercel writes the entry, vercel.json with a catch-all rewrite, and a public dir", async () => {
    const plan = await init("vercel");

    expect(plan.target).toEqual({ type: "vercel" });
    expect(plan.files.map((file) => file.path)).toEqual(["api/index.mjs", "vercel.json", "public/.gitkeep"]);
    expect(JSON.parse(plan.files[1]?.content ?? "")).toEqual({ rewrites: [{ source: "/(.*)", destination: "/api" }], outputDirectory: "public" });
    expect(plan.files[2]?.keep).toBe(true);
    expect(plan.notes.join(" ")).toContain("@blixis-io/http 0.3");
    expect(plan.notes.join(" ")).toContain("vercel link");
  });

  it("netlify writes the function, netlify.toml using the project's package manager, and a public dir", async () => {
    const plan = await init("netlify", "npm");

    expect(plan.files.map((file) => file.path)).toEqual(["netlify/functions/api.mjs", "netlify.toml", "public/.gitkeep"]);
    expect(plan.files[1]?.content).toBe('[build]\n  command = "npm run build"\n  publish = "public"\n  functions = "netlify/functions"\n');
    expect(plan.notes.join(" ")).toContain("netlify link");
  });
});
