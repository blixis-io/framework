import type { DockerTarget, Target } from "./config.js";
import type { Env, Runner, Step } from "./types.js";

export type Phase = "build" | "deploy";

export interface PlanContext {
  cwd: string;
  env: Env;
  tag: string;
}

export interface TargetPlan {
  steps: Step[];
  /** Environment variables the plan needs but the environment lacks. Fatal for a real run, a warning for `--dry-run`. */
  missingEnv: string[];
}

/** One place a Blixis app can be deployed. Adding Vercel, Netlify or Cloudflare means adding an adapter here. */
export interface TargetAdapter<T extends Target> {
  type: T["type"];
  /** The tag/version this deploy will carry. */
  resolveTag(target: T, env: Env, cwd: string, runner: Runner): Promise<string>;
  plan(name: string, target: T, phase: Phase, context: PlanContext): TargetPlan;
}

async function gitShortSha(cwd: string, runner: Runner): Promise<string | undefined> {
  const result = await runner.capture("git", ["rev-parse", "--short", "HEAD"], cwd);
  const sha = result.stdout.trim();
  return result.code === 0 && sha ? sha : undefined;
}

export const dockerAdapter: TargetAdapter<DockerTarget> = {
  type: "docker",

  async resolveTag(target, env, cwd, runner) {
    return target.tag ?? env["BLIX_TAG"] ?? (await gitShortSha(cwd, runner)) ?? "latest";
  },

  plan(_name, target, phase, { cwd, env, tag }) {
    const image = `${target.image}:${tag}`;
    const steps: Step[] = [];
    const missing = new Set<string>();
    const deploying = phase === "deploy";

    if (deploying) {
      for (const name of target.env) {
        if (!env[name]) {
          missing.add(name);
        }
      }
    }

    if (deploying && target.push && target.registry) {
      const { host, usernameEnv, passwordEnv } = target.registry;
      const username = env[usernameEnv];
      if (!username) {
        missing.add(usernameEnv);
      }
      if (!env[passwordEnv]) {
        missing.add(passwordEnv);
      }
      steps.push({
        name: `log in to ${host}`,
        command: "docker",
        args: ["login", host, "-u", username ?? `$${usernameEnv}`, "--password-stdin"],
        cwd,
        stdinFromEnv: passwordEnv,
      });
    }

    steps.push({
      name: `build ${image}`,
      command: "docker",
      args: [
        "build",
        "-t",
        image,
        "-f",
        target.dockerfile,
        ...(target.platform ? ["--platform", target.platform] : []),
        target.context,
      ],
      cwd,
    });

    if (deploying && target.push) {
      steps.push({ name: `push ${image}`, command: "docker", args: ["push", image], cwd });
    }

    if (deploying && target.after) {
      steps.push({
        name: "run the post-push command",
        command: target.after,
        args: [],
        cwd,
        shell: true,
        env: { BLIX_IMAGE: image, BLIX_TAG: tag },
      });
    }

    return { steps, missingEnv: [...missing] };
  },
};

/** A target plus its name, with the adapter's methods already bound to it. */
export interface BoundAdapter {
  resolveTag(env: Env, cwd: string, runner: Runner): Promise<string>;
  plan(phase: Phase, context: PlanContext): TargetPlan;
}

/** Picks the adapter for a target. Each new target type adds a case; the compiler flags a missing one. */
export function adapterFor(name: string, target: Target): BoundAdapter {
  switch (target.type) {
    case "docker":
      return {
        resolveTag: (env, cwd, runner) => dockerAdapter.resolveTag(target, env, cwd, runner),
        plan: (phase, context) => dockerAdapter.plan(name, target, phase, context),
      };
    /* v8 ignore start -- @preserve: exhaustiveness guard, unreachable until a second target type exists */
    default: {
      const unreachable: never = target.type;
      throw new Error(`No adapter for target type ${String(unreachable)}`);
    }
    /* v8 ignore stop */
  }
}
