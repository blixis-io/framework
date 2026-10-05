import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DEFAULT_CLI_VERSIONS } from "./cli-versions.js";
import type { CloudflareTarget } from "./config.js";
import { buildStep, gitTag, npxStep, type InitContext, type InitPlan, type TargetAdapter } from "./target-types.js";

const DEFAULT_WRANGLER_CONFIG = "wrangler.toml";

export const cloudflareAdapter: TargetAdapter<CloudflareTarget> = {
  type: "cloudflare",

  resolveTag: (_target, env, cwd, runner) => gitTag(env, cwd, runner),

  plan(_name, target, phase, { cwd, env, packageManager }) {
    const steps = [buildStep(packageManager, target.build, cwd)];
    if (phase === "deploy") {
      steps.push(
        npxStep("deploy to Cloudflare", cwd, "wrangler", target.cliVersion, [
          "deploy",
          ...(target.config === DEFAULT_WRANGLER_CONFIG ? [] : ["--config", target.config]),
          ...(target.environment ? ["--env", target.environment] : []),
        ]),
      );
    }
    // CLOUDFLARE_API_TOKEN is deliberately not required: a machine that ran `wrangler login` doesn't need one.
    const missingEnv = phase === "deploy" ? target.env.filter((name) => !env[name]) : [];
    return { steps, missingEnv };
  },

  ci: (target) => ({ secrets: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", ...target.env], docker: false }),
};

export function cloudflareEntry(appModule: string, appExport: string): string {
  return `import { createFetchHandler } from "@blixis-io/http";
import { ${appExport} } from "../${appModule}";

export default createFetchHandler(${appExport});
`;
}

/** A Worker name is lowercase letters, digits and dashes: `@acme/My_API` becomes `my-api`. */
export function workerName(packageName: string): string {
  const unscoped = packageName.replace(/^@[^/]+\//, "").toLowerCase();
  return unscoped.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "app";
}

function packageNameOf(cwd: string): string {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    if (typeof manifest === "object" && manifest !== null && "name" in manifest && typeof manifest.name === "string") {
      return manifest.name;
    }
  } catch {
    // No readable package.json: fall through to the directory name.
  }
  return basename(cwd);
}

export function initCloudflare({ cwd, options, now }: InitContext): Promise<InitPlan> {
  const date = (now ?? new Date()).toISOString().slice(0, 10);
  const wrangler = [
    `name = "${workerName(packageNameOf(cwd))}"`,
    'main = "cloudflare/worker.mjs"',
    `compatibility_date = "${date}"`,
    'compatibility_flags = ["nodejs_compat"]',
    "",
  ].join("\n");

  return Promise.resolve({
    target: { type: "cloudflare", cliVersion: DEFAULT_CLI_VERSIONS.wrangler },
    comments: [],
    files: [
      { path: "cloudflare/worker.mjs", content: cloudflareEntry(options.appModule, options.appExport) },
      { path: DEFAULT_WRANGLER_CONFIG, content: wrangler },
    ],
    notes: [
      "the Worker entry uses createFetchHandler, which needs @blixis-io/http 0.3 or newer.",
      "log in once with `npx wrangler login`, or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (in CI too).",
      "wrangler.toml turns on nodejs_compat, which the framework needs. Reaching Postgres from a Worker is not covered by blix deploy.",
    ],
  });
}
