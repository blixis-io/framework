import type { NetlifyTarget } from "./config.js";
import { buildStep, gitTag, npxStep, type InitContext, type InitPlan, type TargetAdapter } from "./target-types.js";

export const netlifyAdapter: TargetAdapter<NetlifyTarget> = {
  type: "netlify",

  resolveTag: (_target, env, cwd, runner) => gitTag(env, cwd, runner),

  plan(_name, target, phase, { cwd, env, packageManager }) {
    const steps = [buildStep(packageManager, target.build, cwd)];
    if (phase === "deploy") {
      steps.push(
        npxStep("deploy to Netlify", cwd, "netlify-cli", target.cliVersion, [
          "deploy",
          "--dir",
          target.dir,
          "--functions",
          target.functions,
          ...(target.site ? ["--site", target.site] : []),
          ...(target.production ? ["--prod"] : []),
        ]),
      );
    }
    // NETLIFY_AUTH_TOKEN is deliberately not required: a machine that ran `netlify login` doesn't need one.
    const missingEnv = phase === "deploy" ? target.env.filter((name) => !env[name]) : [];
    return { steps, missingEnv };
  },

  ci: (target) => ({ secrets: ["NETLIFY_AUTH_TOKEN", ...(target.site ? [] : ["NETLIFY_SITE_ID"]), ...target.env] }),
};

export function netlifyEntry(appModule: string, appExport: string): string {
  return `import { createFetchHandler } from "@blixis-io/http";
import { ${appExport} } from "../../${appModule}";

const handler = createFetchHandler(${appExport});

export default (request) => handler.fetch(request);

export const config = { path: "/*" };
`;
}

export function initNetlify({ packageManager, options }: InitContext): Promise<InitPlan> {
  return Promise.resolve({
    target: { type: "netlify" },
    comments: [],
    files: [
      { path: "netlify/functions/api.mjs", content: netlifyEntry(options.appModule, options.appExport) },
      {
        path: "netlify.toml",
        content: `[build]\n  command = "${packageManager} run build"\n  publish = "public"\n  functions = "netlify/functions"\n`,
      },
      { path: "public/.gitkeep", content: "", keep: true },
    ],
    notes: [
      "the function entry uses createFetchHandler, which needs @blixis-io/http 0.3 or newer.",
      "link the site once with `npx netlify link`, or set NETLIFY_SITE_ID (and NETLIFY_AUTH_TOKEN in CI).",
    ],
  });
}
