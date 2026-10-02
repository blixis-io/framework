import type { VercelTarget } from "./config.js";
import { buildStep, gitTag, npxStep, type InitContext, type InitPlan, type TargetAdapter } from "./target-types.js";

export const vercelAdapter: TargetAdapter<VercelTarget> = {
  type: "vercel",

  resolveTag: (_target, env, cwd, runner) => gitTag(env, cwd, runner),

  plan(_name, target, phase, { cwd, env, packageManager }) {
    const steps = [buildStep(packageManager, target.build, cwd)];
    if (phase === "deploy") {
      steps.push(
        npxStep("deploy to Vercel", cwd, "vercel", target.cliVersion, ["deploy", "--yes", ...(target.production ? ["--prod"] : [])]),
      );
    }
    // VERCEL_TOKEN is deliberately not required: a machine that ran `vercel login` doesn't need one.
    const missingEnv = phase === "deploy" ? target.env.filter((name) => !env[name]) : [];
    return { steps, missingEnv };
  },

  ci: (target) => ({ secrets: ["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID", ...target.env], docker: false }),
};

export function vercelEntry(appModule: string, appExport: string): string {
  return `import { createFetchHandler } from "@blixis-io/http";
import { ${appExport} } from "../${appModule}";

export default createFetchHandler(${appExport});
`;
}

export function initVercel({ options }: InitContext): Promise<InitPlan> {
  return Promise.resolve({
    target: { type: "vercel" },
    comments: [],
    files: [
      { path: "api/index.mjs", content: vercelEntry(options.appModule, options.appExport) },
      {
        path: "vercel.json",
        content: `${JSON.stringify({ rewrites: [{ source: "/(.*)", destination: "/api" }], outputDirectory: "public" }, null, 2)}\n`,
      },
      { path: "public/.gitkeep", content: "", keep: true },
    ],
    notes: [
      "the function entry uses createFetchHandler, which needs @blixis-io/http 0.3 or newer.",
      "link the project once with `npx vercel link`, or set VERCEL_ORG_ID and VERCEL_PROJECT_ID (and VERCEL_TOKEN in CI).",
    ],
  });
}
