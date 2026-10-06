import type { LoadedConfig } from "@blixis-io/cli";
import { z } from "zod";
import { DEFAULT_CLI_VERSIONS, type CliPackage } from "./cli-versions.js";
import { ENV_NAME, ENV_NAME_RULE, TARGET_NAME, TARGET_NAME_RULE } from "./safe-names.js";

/** An environment variable name, checked because generated CI files turn it into a YAML key and a secret reference. */
const EnvNameSchema = z.string().regex(ENV_NAME, ENV_NAME_RULE);

/** Words `blix deploy <word>` already means, so a target can't be named any of them. */
export const RESERVED_TARGET_NAMES = ["init", "build", "ci", "doctor", "help"] as const;

const RegistrySchema = z.strictObject({
  host: z.string().min(1),
  /** Environment variable holding the registry username. */
  usernameEnv: EnvNameSchema.default("REGISTRY_USERNAME"),
  /** Environment variable holding the registry password or token. Piped to `docker login` on stdin, never put in argv. */
  passwordEnv: EnvNameSchema.default("REGISTRY_PASSWORD"),
});

const DockerTargetSchema = z.strictObject({
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
  env: z.array(EnvNameSchema).default([]),
});

/** The provider CLI `npx` runs, pinned by default: it runs with your deploy credentials in its environment, so `latest` would run whatever is published next. Say `"latest"` here to opt in anyway. */
const cliVersionOf = (cli: CliPackage) => z.string().min(1).default(DEFAULT_CLI_VERSIONS[cli]);

const ToolBase = {
  /** Your build command. Defaults to the package manager's `run build`. */
  build: z.string().min(1).optional(),
  /** Environment variable names this target needs; `doctor` checks them and generated CI files pass them through as secrets. */
  env: z.array(EnvNameSchema).default([]),
};

const ProviderBase = {
  /** Deploy to production (the default) rather than a preview. */
  production: z.boolean().default(true),
  ...ToolBase,
};

const VercelTargetSchema = z.strictObject({ type: z.literal("vercel"), ...ProviderBase, cliVersion: cliVersionOf("vercel") });

const NetlifyTargetSchema = z.strictObject({
  type: z.literal("netlify"),
  ...ProviderBase,
  cliVersion: cliVersionOf("netlify-cli"),
  /** Static publish directory. Netlify wants one even for a functions-only site. */
  dir: z.string().min(1).default("public"),
  functions: z.string().min(1).default("netlify/functions"),
  /** Site id. Otherwise `NETLIFY_SITE_ID`, or the linked site. */
  site: z.string().min(1).optional(),
});

const CloudflareTargetSchema = z.strictObject({
  type: z.literal("cloudflare"),
  ...ToolBase,
  cliVersion: cliVersionOf("wrangler"),
  /** A named Wrangler environment (`wrangler deploy --env <name>`). Omit for the default one. */
  environment: z.string().min(1).optional(),
  /** Wrangler config file. Only passed to Wrangler when it isn't the default `wrangler.toml`. */
  config: z.string().min(1).default("wrangler.toml"),
});

export const TargetSchema = z.discriminatedUnion("type", [DockerTargetSchema, VercelTargetSchema, NetlifyTargetSchema, CloudflareTargetSchema]);

const DeploySchema = z.strictObject({
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
    const problems = parsed.error.issues.flatMap((issue) => {
      const where = `deploy.${issue.path.join(".") || "(root)"}`;
      if (issue.code !== "unrecognized_keys") {
        return [`  - ${where}: ${issue.message}`];
      }
      const known = knownOptionsAt(issue.path, section);
      return issue.keys.map((key) => `  - ${where}: unknown option "${key}" (${hintFor(key, known)})`);
    });
    throw new DeployConfigError(`Invalid deploy config in ${relativeName(loaded.path)}:\n${problems.join("\n")}`);
  }

  const config = parsed.data;
  const names = Object.keys(config.targets);
  if (names.length === 0) {
    throw new DeployConfigError('deploy.targets is empty. Add at least one target, e.g. { prod: { type: "docker", image: "..." } }.');
  }
  const unsafe = names.find((name) => !TARGET_NAME.test(name));
  if (unsafe !== undefined) {
    throw new DeployConfigError(`deploy.targets: ${JSON.stringify(unsafe)} can't be a target name (it goes into a generated CI file): ${TARGET_NAME_RULE}.`);
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

const TARGET_SCHEMAS = { docker: DockerTargetSchema, vercel: VercelTargetSchema, netlify: NetlifyTargetSchema, cloudflare: CloudflareTargetSchema } as const;

function isSchemaType(value: string): value is keyof typeof TARGET_SCHEMAS {
  return Object.hasOwn(TARGET_SCHEMAS, value);
}

/** The option names valid where an unknown one was found: the deploy section, a target of its own type, or a registry. */
function knownOptionsAt(path: readonly PropertyKey[], section: unknown): string[] {
  if (path.length === 0) {
    return Object.keys(DeploySchema.shape);
  }
  if (path.length === 3 && path[2] === "registry") {
    return Object.keys(RegistrySchema.shape);
  }
  if (path.length === 2 && path[0] === "targets") {
    const targets = typeof section === "object" && section !== null ? Reflect.get(section, "targets") : undefined;
    const target = typeof targets === "object" && targets !== null ? Reflect.get(targets, String(path[1])) : undefined;
    const type = typeof target === "object" && target !== null ? Reflect.get(target, "type") : undefined;
    if (typeof type === "string" && isSchemaType(type)) {
      return Object.keys(TARGET_SCHEMAS[type].shape);
    }
  }
  return [];
}

/** Plain Levenshtein distance: how many single-character edits turn `a` into `b`. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row++) {
    const current = [row];
    for (let column = 1; column <= b.length; column++) {
      current[column] = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** `did you mean "push"?` for a close match, else the list of valid options. */
function hintFor(key: string, known: readonly string[]): string {
  const limit = Math.max(1, Math.floor(key.length / 3));
  let best: { name: string; distance: number } | undefined;
  for (const name of known) {
    const distance = editDistance(key.toLowerCase(), name.toLowerCase());
    if (distance <= limit && (best === undefined || distance < best.distance)) {
      best = { name, distance };
    }
  }
  if (best) {
    return `did you mean "${best.name}"?`;
  }
  return known.length > 0 ? `known options: ${known.join(", ")}` : "no option of that name";
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
