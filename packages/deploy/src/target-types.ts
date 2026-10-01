import type { PackageManager } from "@blixis-io/cli";
import type { Target } from "./config.js";
import type { Env, Runner, Step } from "./types.js";

export type Phase = "build" | "deploy";

export interface PlanContext {
  cwd: string;
  env: Env;
  tag: string;
  packageManager: PackageManager;
}

export interface TargetPlan {
  steps: Step[];
  /** Environment variables the plan needs but the environment lacks. Fatal for a real run, a warning for `--dry-run`. */
  missingEnv: string[];
}

/** What a generated CI file must provide for a target. */
export interface CiRequirements {
  /** Environment variable names to pass through from the CI secret store. */
  secrets: string[];
  registry?: { host: string; usernameEnv: string; passwordEnv: string } | undefined;
}

/** One place a Blixis app can be deployed. Adding a new platform means adding an adapter. */
export interface TargetAdapter<T extends Target> {
  type: T["type"];
  /** The tag/version this deploy will carry. For providers that have no image tag it is just a label. */
  resolveTag(target: T, env: Env, cwd: string, runner: Runner): Promise<string>;
  plan(name: string, target: T, phase: Phase, context: PlanContext): TargetPlan;
  ci(target: T): CiRequirements;
}

export interface InitOptions {
  /** Docker: the image name. */
  image?: string | undefined;
  /** Docker: the compiled entry the container runs. */
  entry: string;
  /** Vercel/Netlify: the compiled module that exports the Blixis app module, relative to the project root. */
  appModule: string;
  appExport: string;
}

export interface InitContext {
  cwd: string;
  packageManager: PackageManager;
  runner: Runner;
  options: InitOptions;
}

export interface InitFile {
  path: string;
  content: string;
  /** Never overwritten, even with `--force` (a generated `.dockerignore` is a starting point, not a managed file). */
  keep?: boolean;
}

/** What `blix deploy init --target <type>` writes. */
export interface InitPlan {
  /** The target as it appears in `blix.config.ts`. */
  target: Record<string, unknown>;
  /** Lines placed inside the target as comments in the generated config. */
  comments: string[];
  files: InitFile[];
  notes: string[];
}

/** The shared build step: the project's own `build` script, or the target's override. */
export function buildStep(packageManager: PackageManager, override: string | undefined, cwd: string): Step {
  return override
    ? { name: "build the project", command: override, args: [], cwd, shell: true }
    : { name: "build the project", command: packageManager, args: ["run", "build"], cwd };
}

/** `BLIX_TAG`, else the short git commit, else `latest`. */
export async function gitTag(env: Env, cwd: string, runner: Runner): Promise<string> {
  const fromEnv = env["BLIX_TAG"];
  if (fromEnv) {
    return fromEnv;
  }
  const result = await runner.capture("git", ["rev-parse", "--short", "HEAD"], cwd);
  const sha = result.stdout.trim();
  return result.code === 0 && sha ? sha : "latest";
}

/** `npx --yes <package>@<version> ...args`: runs a provider's CLI without requiring it to be installed. */
export function npxStep(name: string, cwd: string, pkg: string, version: string, args: readonly string[]): Step {
  return { name, command: "npx", args: ["--yes", `${pkg}@${version}`, ...args], cwd };
}
