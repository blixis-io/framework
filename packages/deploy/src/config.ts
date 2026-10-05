import type { LoadedConfig } from "@blixis-io/cli";
import { z } from "zod";

/** Words `blix deploy <word>` already means, so a target can't be named any of them. */
export const RESERVED_TARGET_NAMES = ["init", "build", "ci", "doctor", "help"] as const;

const RegistrySchema = z.object({
  host: z.string().min(1),
  /** Environment variable holding the registry username. */
  usernameEnv: z.string().min(1).default("REGISTRY_USERNAME"),
  /** Environment variable holding the registry password or token. Piped to `docker login` on stdin, never put in argv. */
  passwordEnv: z.string().min(1).default("REGISTRY_PASSWORD"),
});

const DockerTargetSchema = z.object({
  type: z.literal("docker"),
  /** Image name without a tag, e.g. `ghcr.io/acme/api`. */
  image: z.string().min(1),
  registry: RegistrySchema.optional(),
  dockerfile: z.string().min(1).default("Dockerfile"),
  context: z.string().min(1).default("."),
  platform: z.string().min(1).optional(),
  /** Image tag. Defaults to `$BLIX_TAG`, else the short git commit, else `latest`. */
  tag: z.string().min(1).optional(),
  /** Push the image after building it. Default true. */
  push: z.boolean().default(true),
  /** A shell command run after the push (e.g. `fly deploy --image "$BLIX_IMAGE"`); it sees `BLIX_IMAGE` and `BLIX_TAG`. This is how Fly, Railway, Render or a VPS pick the new image up. */
  after: z.string().min(1).optional(),
  /** Environment variable names this target needs. `blix deploy doctor` checks them; generated CI files pass them through as secrets. */
  env: z.array(z.string().min(1)).default([]),
});

const ToolBase = {
  /** Your build command. Defaults to the package manager's `run build`. */
  build: z.string().min(1).optional(),
  /** Version of the provider's CLI that `npx` runs. Pin it for reproducible deploys. */
  cliVersion: z.string().min(1).default("latest"),
  /** Environment variable names this target needs; `doctor` checks them and generated CI files pass them through as secrets. */
  env: z.array(z.string().min(1)).default([]),
};

const ProviderBase = {
  /** Deploy to production (the default) rather than a preview. */
  production: z.boolean().default(true),
  ...ToolBase,
};

const VercelTargetSchema = z.object({ type: z.literal("vercel"), ...ProviderBase });

const NetlifyTargetSchema = z.object({
  type: z.literal("netlify"),
  ...ProviderBase,
  /** Static publish directory. Netlify wants one even for a functions-only site. */
  dir: z.string().min(1).default("public"),
  functions: z.string().min(1).default("netlify/functions"),
  /** Site id. Otherwise `NETLIFY_SITE_ID`, or the linked site. */
  site: z.string().min(1).optional(),
});

const CloudflareTargetSchema = z.object({
  type: z.literal("cloudflare"),
  ...ToolBase,
  /** A named Wrangler environment (`wrangler deploy --env <name>`). Omit for the default one. */
  environment: z.string().min(1).optional(),
  /** Wrangler config file. Only passed to Wrangler when it isn't the default `wrangler.toml`. */
  config: z.string().min(1).default("wrangler.toml"),
});

export const TargetSchema = z.discriminatedUnion("type", [DockerTargetSchema, VercelTargetSchema, NetlifyTargetSchema, CloudflareTargetSchema]);

const DeploySchema = z.object({
  targets: z.record(z.string().min(1), TargetSchema),
  /** Used when `blix deploy` is run without a target. Optional when there is exactly one target. */
  default: z.string().min(1).optional(),
});

export type RegistryConfig = z.output<typeof RegistrySchema>;
export type DockerTarget = z.output<typeof DockerTargetSchema>;
export type VercelTarget = z.output<typeof VercelTargetSchema>;
export type NetlifyTarget = z.output<typeof NetlifyTargetSchema>;
export type CloudflareTarget = z.output<typeof CloudflareTargetSchema>;
export type Target = z.output<typeof TargetSchema>;
export type DeployConfig = z.output<typeof DeploySchema>;
/** What a user writes: defaults are optional. */
export type DeployConfigInput = z.input<typeof DeploySchema>;

/** Identity helper so a config gets autocomplete: `deploy: defineDeployConfig({ ... })`. */
export function defineDeployConfig(config: DeployConfigInput): DeployConfigInput {
  return config;
}

export class DeployConfigError extends Error {
  override readonly name = "DeployConfigError";
}

/** Validates the `deploy` section of `blix.config.*`. Throws `DeployConfigError` with every problem spelled out. */
export function parseDeployConfig(loaded: LoadedConfig | undefined): DeployConfig {
  if (!loaded) {
    throw new DeployConfigError("No blix.config.ts found. Run `blix deploy init` to create one.");
  }
  const section = loaded.config["deploy"];
  if (section === undefined) {
    throw new DeployConfigError(`${relativeName(loaded.path)} has no "deploy" section. Run \`blix deploy init\` to add one.`);
  }

  const parsed = DeploySchema.safeParse(section);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  - deploy.${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new DeployConfigError(`Invalid deploy config in ${relativeName(loaded.path)}:\n${problems.join("\n")}`);
  }

  const config = parsed.data;
  const names = Object.keys(config.targets);
  if (names.length === 0) {
    throw new DeployConfigError('deploy.targets is empty. Add at least one target, e.g. { prod: { type: "docker", image: "..." } }.');
  }
  const reserved = names.find((name) => (RESERVED_TARGET_NAMES as readonly string[]).includes(name));
  if (reserved) {
    throw new DeployConfigError(`"${reserved}" can't be a target name: it's a blix deploy command (${RESERVED_TARGET_NAMES.join(", ")}).`);
  }
  if (config.default !== undefined && !names.includes(config.default)) {
    throw new DeployConfigError(`deploy.default is "${config.default}", but the targets are: ${names.join(", ")}.`);
  }
  return config;
}

function relativeName(path: string): string {
  return path.split(/[\\\\/]/).pop() ?? path;
}

/** The target `blix deploy [name]` means: the named one, else `default`, else the only one. */
export function selectTarget(config: DeployConfig, name: string | undefined): { name: string; target: Target } {
  const names = Object.keys(config.targets);
  const chosen = name ?? config.default ?? (names.length === 1 ? names[0] : undefined);
  if (chosen === undefined) {
    throw new DeployConfigError(`Which target? Pass one of: ${names.join(", ")} (or set deploy.default).`);
  }
  const target = Object.hasOwn(config.targets, chosen) ? config.targets[chosen] : undefined;
  if (!target) {
    throw new DeployConfigError(`Unknown target "${chosen}". Targets: ${names.join(", ")}.`);
  }
  return { name: chosen, target };
}
