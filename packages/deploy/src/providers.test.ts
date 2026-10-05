import { describe, expect, it } from "vitest";
import { cloudflareAdapter, cloudflareEntry, initCloudflare, workerName } from "./cloudflare.js";
import { DEFAULT_CLI_VERSIONS } from "./cli-versions.js";
import { parseDeployConfig, type CloudflareTarget, type NetlifyTarget, type VercelTarget } from "./config.js";
import { netlifyEntry } from "./netlify.js";
import { renderConfigFile } from "./config-file.js";
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

function cloudflare(extra: Record<string, unknown> = {}): CloudflareTarget {
  const target = targetOf("cloudflare", extra);
  if (target?.type !== "cloudflare") {
    throw new Error("expected a cloudflare target");
  }
  return target;
}

const ctx = (extra: Record<string, unknown> = {}) => ({ cwd: "/app", env: {}, tag: "abc1234", packageManager: "pnpm" as const, ...extra });
const commands = (steps: { command: string; args: readonly string[] }[]) => steps.map((step) => [step.command, ...step.args].join(" "));

describe("config defaults", () => {
  it("vercel", () => {
    expect(vercel()).toEqual({ type: "vercel", production: true, cliVersion: DEFAULT_CLI_VERSIONS.vercel, env: [] });
  });

  it("netlify", () => {
    expect(netlify()).toEqual({
      type: "netlify",
      production: true,
      cliVersion: DEFAULT_CLI_VERSIONS["netlify-cli"],
      env: [],
      dir: "public",
      functions: "netlify/functions",
    });
  });
});

describe("vercelAdapter.plan", () => {
  it("builds the project, then deploys to production", () => {
    const { steps, missingEnv } = vercelAdapter.plan("prod", vercel(), "deploy", ctx());

    expect(commands(steps)).toEqual(["pnpm run build", `npx --yes vercel@${DEFAULT_CLI_VERSIONS.vercel} deploy --yes --prod`]);
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
      docker: false,
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

    expect(commands(steps)).toEqual(["pnpm run build", `npx --yes netlify-cli@${DEFAULT_CLI_VERSIONS["netlify-cli"]} deploy --dir public --functions netlify/functions --prod`]);
  });

  it("passes a configured site, dir and functions directory, and drops --prod for a preview", () => {
    const target = netlify({ site: "abc-123", dir: "static", functions: "fns", production: false });

    expect(commands(netlifyAdapter.plan("prod", target, "deploy", ctx()).steps)[1]).toBe(
      `npx --yes netlify-cli@${DEFAULT_CLI_VERSIONS["netlify-cli"]} deploy --dir static --functions fns --site abc-123`,
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

    expect(plan.target).toEqual({ type: "vercel", cliVersion: DEFAULT_CLI_VERSIONS.vercel });
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

describe("cloudflare", () => {
  it("config defaults", () => {
    expect(cloudflare()).toEqual({ type: "cloudflare", cliVersion: DEFAULT_CLI_VERSIONS.wrangler, env: [], config: "wrangler.toml" });
  });

  it("builds, then deploys with wrangler; the default config file is not passed", () => {
    const { steps, missingEnv } = cloudflareAdapter.plan("edge", cloudflare(), "deploy", ctx());

    expect(commands(steps)).toEqual(["pnpm run build", `npx --yes wrangler@${DEFAULT_CLI_VERSIONS.wrangler} deploy`]);
    expect(missingEnv).toEqual([]);
  });

  it("passes a custom config file, a named environment and a pinned CLI version", () => {
    const target = cloudflare({ config: "wrangler.jsonc", environment: "staging", cliVersion: "4.146.0" });

    expect(commands(cloudflareAdapter.plan("edge", target, "deploy", ctx()).steps)[1]).toBe(
      "npx --yes wrangler@4.146.0 deploy --config wrangler.jsonc --env staging",
    );
  });

  it("a build-only plan is just the build; listed variables are required only to deploy", () => {
    const target = cloudflare({ env: ["API_KEY"] });

    expect(commands(cloudflareAdapter.plan("edge", target, "build", ctx()).steps)).toEqual(["pnpm run build"]);
    expect(cloudflareAdapter.plan("edge", target, "deploy", ctx()).missingEnv).toEqual(["API_KEY"]);
  });

  it("CI needs the Cloudflare credentials plus the target's own variables, and no Docker", () => {
    expect(cloudflareAdapter.ci(cloudflare({ env: ["X"] }))).toEqual({ secrets: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "X"], docker: false });
  });

  it("labels the deploy with the git commit", async () => {
    await expect(cloudflareAdapter.resolveTag(cloudflare(), { BLIX_TAG: "v3" }, "/app", fakeRunner())).resolves.toBe("v3");
  });

  it("the Worker entry exports createFetchHandler of the app module (golden)", () => {
    expect(cloudflareEntry("dist/app.module.js", "AppModule")).toBe(`import { createFetchHandler } from "@blixis-io/http";
import { AppModule } from "../dist/app.module.js";

export default createFetchHandler(AppModule);
`);
  });

  it.each([
    ["my-api", "my-api"],
    ["@acme/My_Orders.API", "my-orders-api"],
    ["UPPER", "upper"],
    ["--weird--name--", "weird-name"],
    ["@scope/", "app"],
    ["", "app"],
  ])("workerName(%j) is %j", (packageName, expected) => {
    expect(workerName(packageName)).toBe(expected);
  });

  it("initCloudflare writes wrangler.toml with the injected date (golden)", async () => {
    const plan = await initCloudflare({
      cwd: "/definitely/not/a/project/my-worker",
      packageManager: "pnpm",
      runner: fakeRunner(),
      options: { entry: "dist/main.js", appModule: "dist/app.module.js", appExport: "AppModule" },
      now: new Date("2026-10-02T12:00:00Z"),
    });

    expect(plan.files.map((file) => file.path)).toEqual(["cloudflare/worker.mjs", "wrangler.toml"]);
    // No package.json there, so the name falls back to the directory name.
    expect(plan.files[1]?.content).toBe(`name = "my-worker"
main = "cloudflare/worker.mjs"
compatibility_date = "2026-10-02"
compatibility_flags = ["nodejs_compat"]
`);
    expect(plan.target).toEqual({ type: "cloudflare", cliVersion: DEFAULT_CLI_VERSIONS.wrangler });
  });

  it("adapterFor binds it", () => {
    expect(adapterFor("edge", cloudflare()).ci().secrets).toContain("CLOUDFLARE_API_TOKEN");
  });
});

const pinnedPlan = (type: "vercel" | "netlify" | "cloudflare") =>
  initPlanFor(type, { cwd: "/app", packageManager: "pnpm", runner: fakeRunner(), options: { entry: "dist/main.js", appModule: "dist/app.module.js", appExport: "AppModule" } });

describe("initPlanFor: the provider CLI version is written into the config", () => {
  it.each([
    ["vercel", DEFAULT_CLI_VERSIONS.vercel],
    ["netlify", DEFAULT_CLI_VERSIONS["netlify-cli"]],
    ["cloudflare", DEFAULT_CLI_VERSIONS.wrangler],
  ] as const)("%s: the generated blix.config.ts pins %s, so the repo, not the next publish, decides when it changes", async (type, version) => {
    const { target, comments } = await pinnedPlan(type);

    expect(target["cliVersion"]).toBe(version);
    expect(renderConfigFile("prod", target, comments)).toContain(`cliVersion: "${version}"`);
  });

  it("does not add one to a docker target, which runs no provider CLI", async () => {
    const docker = await initPlanFor("docker", { cwd: "/app", packageManager: "pnpm", runner: fakeRunner(), options: { entry: "dist/main.js", appModule: "dist/app.module.js", appExport: "AppModule" } });

    expect(docker.target).not.toHaveProperty("cliVersion");
  });
});
