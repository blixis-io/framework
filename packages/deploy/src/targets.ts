import type { Target } from "./config.js";
import { dockerAdapter, initDocker } from "./docker.js";
import { initNetlify, netlifyAdapter } from "./netlify.js";
import type { CiRequirements, InitContext, InitPlan, Phase, PlanContext, TargetPlan } from "./target-types.js";
import { initVercel, vercelAdapter } from "./vercel.js";
import type { Env, Runner } from "./types.js";

export { dockerAdapter } from "./docker.js";
export { netlifyAdapter } from "./netlify.js";
export { vercelAdapter } from "./vercel.js";
export type {
  CiRequirements,
  InitContext,
  InitFile,
  InitOptions,
  InitPlan,
  Phase,
  PlanContext,
  TargetAdapter,
  TargetPlan,
} from "./target-types.js";

/** Every supported `type`, in the order `init` lists them. */
export const TARGET_TYPES = ["docker", "vercel", "netlify"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export function isTargetType(value: string): value is TargetType {
  return (TARGET_TYPES as readonly string[]).includes(value);
}

/** A target plus its name, with the adapter's methods already bound to it. */
export interface BoundAdapter {
  resolveTag(env: Env, cwd: string, runner: Runner): Promise<string>;
  plan(phase: Phase, context: PlanContext): TargetPlan;
  ci(): CiRequirements;
}

/** Picks the adapter for a target. Each new target type adds a case; the compiler flags a missing one. */
export function adapterFor(name: string, target: Target): BoundAdapter {
  switch (target.type) {
    case "docker":
      return {
        resolveTag: (env, cwd, runner) => dockerAdapter.resolveTag(target, env, cwd, runner),
        plan: (phase, context) => dockerAdapter.plan(name, target, phase, context),
        ci: () => dockerAdapter.ci(target),
      };
    case "vercel":
      return {
        resolveTag: (env, cwd, runner) => vercelAdapter.resolveTag(target, env, cwd, runner),
        plan: (phase, context) => vercelAdapter.plan(name, target, phase, context),
        ci: () => vercelAdapter.ci(target),
      };
    case "netlify":
      return {
        resolveTag: (env, cwd, runner) => netlifyAdapter.resolveTag(target, env, cwd, runner),
        plan: (phase, context) => netlifyAdapter.plan(name, target, phase, context),
        ci: () => netlifyAdapter.ci(target),
      };
    /* v8 ignore start -- @preserve: exhaustiveness guard, unreachable while every type has a case */
    default: {
      const unreachable: never = target;
      throw new Error(`No adapter for target ${JSON.stringify(unreachable)}`);
    }
    /* v8 ignore stop */
  }
}

/** What `blix deploy init --target <type>` should write. */
export function initPlanFor(type: TargetType, context: InitContext): Promise<InitPlan> {
  switch (type) {
    case "docker":
      return initDocker(context);
    case "vercel":
      return initVercel(context);
    case "netlify":
      return initNetlify(context);
    /* v8 ignore start -- @preserve: exhaustiveness guard, unreachable while every type has a case */
    default: {
      const unreachable: never = type;
      throw new Error(`No init for target type ${String(unreachable)}`);
    }
    /* v8 ignore stop */
  }
}
