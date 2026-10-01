import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { detectPackageManager, type CliResult, type CommandContext } from "@blixis-io/cli";
import { CI_PROVIDER_IDS, ciProviderFor } from "./ci.js";
import { DeployConfigError, parseDeployConfig, selectTarget, type DeployConfig } from "./config.js";
import { DOCKERIGNORE, DockerfileError, renderDockerfile } from "./dockerfile.js";
import { formatStep } from "./runner.js";
import { adapterFor, type Phase } from "./targets.js";
import type { Env, Runner, Step } from "./types.js";

export interface DeployDeps {
  runner: Runner;
  env: Env;
  /** Progress lines for a real run, written as they happen (child output streams past this). */
  log: (line: string) => void;
}

export const USAGE = `blix deploy [target] [--dry-run]      build and ship a target (default target or the only one)
blix deploy build [target]            build only: no login, push or post-push command
blix deploy init [--target docker] [--ci github] [--image <name>] [--branch main] [--entry dist/main.js] [--force]
                                      write blix.config.ts, a Dockerfile and a CI workflow
blix deploy ci <provider> [target] [--branch main] [--force]
                                      (re)generate the CI file. Providers: ${CI_PROVIDER_IDS.join(", ")}
blix deploy doctor [target]           check config, tools and environment

--dry-run prints every command and runs none of them.
`;

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | true>;
}

const VALUE_FLAGS = new Set(["target", "ci", "image", "branch", "entry"]);
const BOOLEAN_FLAGS = new Set(["dry-run", "force", "help"]);

function parseArgs(args: readonly string[]): ParsedArgs | string {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const [name = "", inline] = arg.slice(2).split(/=(.*)/s);
    if (BOOLEAN_FLAGS.has(name)) {
      flags.set(name, true);
    } else if (VALUE_FLAGS.has(name)) {
      const value = inline ?? args[++index];
      if (value === undefined || value.startsWith("--")) {
        return `--${name} needs a value`;
      }
      flags.set(name, value);
    } else {
      return `Unknown option --${name}`;
    }
  }
  return { positionals, flags };
}

function flag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

const fail = (message: string): CliResult => ({ exitCode: 1, stdout: "", stderr: `${message}\n` });
const ok = (stdout: string): CliResult => ({ exitCode: 0, stdout, stderr: "" });

/** `blix deploy ...`: dispatches to init / build / ci / doctor, or deploys. */
export async function runDeploy(context: CommandContext, deps: DeployDeps): Promise<CliResult> {
  const parsed = parseArgs(context.args);
  if (typeof parsed === "string") {
    return fail(`${parsed}\n\n${USAGE}`);
  }
  if (parsed.flags.has("help")) {
    return ok(USAGE);
  }

  const [first, ...rest] = parsed.positionals;
  try {
    switch (first) {
      case "init":
        return await runInit(context, parsed, deps);
      case "ci":
        return await runCi(context, { ...parsed, positionals: rest });
      case "doctor":
        return await runDoctor(context, rest[0], deps);
      case "build":
        return await runPlan(context, rest[0], "build", parsed.flags.has("dry-run"), deps);
      default:
        return await runPlan(context, first, "deploy", parsed.flags.has("dry-run"), deps);
    }
  } catch (error) {
    if (error instanceof DeployConfigError || error instanceof DockerfileError) {
      return fail(error.message);
    }
    throw error;
  }
}

async function runPlan(
  context: CommandContext,
  targetName: string | undefined,
  phase: Phase,
  dryRun: boolean,
  deps: DeployDeps,
): Promise<CliResult> {
  const config = parseDeployConfig(context.config);
  const { name, target } = selectTarget(config, targetName);
  const adapter = adapterFor(name, target);

  const tag = await adapter.resolveTag(deps.env, context.cwd, deps.runner);
  const plan = adapter.plan(phase, { cwd: context.cwd, env: deps.env, tag });

  if (dryRun) {
    const lines = [`# ${phase} ${name} (${target.type}), tag ${tag}`, ...plan.steps.map((step) => `$ ${formatStep(step)}`)];
    if (plan.missingEnv.length > 0) {
      lines.push(`# would need these environment variables: ${plan.missingEnv.join(", ")}`);
    }
    return ok(`${lines.join("\n")}\n`);
  }

  if (plan.missingEnv.length > 0) {
    return fail(`Missing environment variables for ${name}: ${plan.missingEnv.join(", ")}.\nSet them (in CI: as secrets), or run with --dry-run to see what would happen.`);
  }

  for (const step of plan.steps) {
    deps.log(`\n> ${step.name}\n$ ${formatStep(step)}\n`);
    const code = await deps.runner.run(step);
    if (code !== 0) {
      return { exitCode: code, stdout: "", stderr: `Step failed (exit ${code}): ${step.name}\n` };
    }
  }
  return ok(`\n${phase === "build" ? "Built" : "Deployed"} ${name} (${target.type}), tag ${tag}.\n`);
}

type FileOutcome = "created" | "overwrote" | "kept";

function writeFile(path: string, content: string, force: boolean): FileOutcome {
  const existed = existsSync(path);
  if (existed && !force) {
    return "kept";
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return existed ? "overwrote" : "created";
}

/** `ghcr.io/owner/repo` from a GitHub remote URL, lower-cased (registries require it). */
export function imageFromRemote(url: string): string | undefined {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\s*$/.exec(url.trim());
  return match ? `ghcr.io/${match[1]}/${match[2]}`.toLowerCase() : undefined;
}

/** The registry host of an image name: its first path segment if that looks like a host, else Docker Hub. */
export function registryHostOf(image: string): string {
  const first = image.split("/")[0] ?? "";
  return image.includes("/") && /[.:]|^localhost$/.test(first) ? first : "docker.io";
}

function configTemplate(image: string, registryHost: string): string {
  return `import { defineConfig } from "@blixis-io/cli";

export default defineConfig({
  deploy: {
    targets: {
      prod: {
        type: "docker",
        image: ${JSON.stringify(image)},
        registry: { host: ${JSON.stringify(registryHost)} },
        // after: 'fly deploy --image "$BLIX_IMAGE"',  // tell your host to pick up the new image
      },
    },
  },
});
`;
}

/** True when package.json pins a package manager (`"packageManager": "pnpm@11.25.0"`), which corepack inside the image honours. */
function pinsPackageManager(cwd: string): boolean {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    return typeof manifest === "object" && manifest !== null && "packageManager" in manifest && typeof manifest.packageManager === "string";
  } catch {
    return false;
  }
}

const CONFIG_NAMES = ["blix.config.ts", "blix.config.mts", "blix.config.js", "blix.config.mjs", "blix.config.json"];

async function runInit(context: CommandContext, parsed: ParsedArgs, deps: DeployDeps): Promise<CliResult> {
  const type = flag(parsed, "target") ?? "docker";
  if (type !== "docker") {
    return fail(`Unsupported target "${type}". Supported: docker. (Vercel, Netlify and Cloudflare are planned.)`);
  }
  const ciId = flag(parsed, "ci");
  const ci = ciId ? ciProviderFor(ciId) : undefined;
  if (ciId && !ci) {
    return fail(`Unknown CI provider "${ciId}". Providers: ${CI_PROVIDER_IDS.join(", ")}.`);
  }

  const force = parsed.flags.has("force");
  const cwd = context.cwd;
  const pm = detectPackageManager(cwd);
  const entry = flag(parsed, "entry") ?? "dist/main.js";
  const lines: string[] = [];

  let image = flag(parsed, "image");
  if (!image) {
    const remote = await deps.runner.capture("git", ["remote", "get-url", "origin"], cwd);
    image = (remote.code === 0 ? imageFromRemote(remote.stdout) : undefined) ?? `ghcr.io/OWNER/${basename(cwd).toLowerCase()}`;
    if (image.includes("OWNER")) {
      lines.push(`note: couldn't work out your registry namespace; edit "image" in blix.config.ts (now ${image}).`);
    }
  }
  const registryHost = registryHostOf(image);

  const existingConfig = CONFIG_NAMES.find((name) => existsSync(join(cwd, name)));
  if (existingConfig) {
    lines.push(`kept ${existingConfig} (add the deploy section from \`blix deploy init\` yourself if it has none)`);
  } else {
    lines.push(`${writeFile(join(cwd, "blix.config.ts"), configTemplate(image, registryHost), force)} blix.config.ts`);
  }

  const dockerfile = join(cwd, "Dockerfile");
  if (existsSync(dockerfile) && !force) {
    lines.push("kept Dockerfile");
  } else {
    lines.push(`${writeFile(dockerfile, renderDockerfile({ packageManager: pm, entry }), force)} Dockerfile`);
  }
  lines.push(`${writeFile(join(cwd, ".dockerignore"), DOCKERIGNORE, false)} .dockerignore`);

  if (ci) {
    lines.push(
      `${writeFile(
        join(cwd, ci.filePath),
        ci.render({
          target: "prod",
          packageManager: pm,
          nodeVersion: "24",
          branch: flag(parsed, "branch") ?? "main",
          secrets: [],
          registry: { host: registryHost, usernameEnv: "REGISTRY_USERNAME", passwordEnv: "REGISTRY_PASSWORD" },
        }),
        force,
      )} ${ci.filePath}`,
    );
  }

  if (pm === "pnpm" && !pinsPackageManager(cwd)) {
    lines.push(
      "",
      'note: package.json has no "packageManager" field, so the image installs whichever pnpm corepack picks, which may not be yours.',
      "      Pin it with: corepack use pnpm@latest  (or set it by hand, e.g. \"packageManager\": \"pnpm@11.25.0\")",
    );
  }
  lines.push("", "Next: review blix.config.ts, then run `blix deploy --dry-run` to see what a deploy would do.");
  return ok(`${lines.join("\n")}\n`);
}

async function runCi(context: CommandContext, parsed: ParsedArgs): Promise<CliResult> {
  const [providerId, targetName] = parsed.positionals;
  const provider = providerId ? ciProviderFor(providerId) : undefined;
  if (!provider) {
    return fail(`${providerId ? `Unknown CI provider "${providerId}"` : "Usage: blix deploy ci <provider> [target]"}. Providers: ${CI_PROVIDER_IDS.join(", ")}.`);
  }

  const config: DeployConfig = parseDeployConfig(context.config);
  const { name, target } = selectTarget(config, targetName);
  const registry = target.registry;
  const outcome = writeFile(
    join(context.cwd, provider.filePath),
    provider.render({
      target: name,
      packageManager: detectPackageManager(context.cwd),
      nodeVersion: "24",
      branch: flag(parsed, "branch") ?? "main",
      secrets: target.env,
      registry,
    }),
    parsed.flags.has("force"),
  );

  if (outcome === "kept") {
    return fail(`${provider.filePath} already exists. Pass --force to overwrite it.`);
  }
  return ok(`${outcome} ${provider.filePath}\n`);
}

async function runDoctor(context: CommandContext, targetName: string | undefined, deps: DeployDeps): Promise<CliResult> {
  const lines: string[] = [];
  let failed = false;

  const config = parseDeployConfig(context.config);
  lines.push(`ok      config: ${Object.keys(config.targets).join(", ")}`);

  const selected = targetName ? [selectTarget(config, targetName)] : Object.entries(config.targets).map(([name, target]) => ({ name, target }));

  const git = await deps.runner.capture("git", ["--version"], context.cwd);
  lines.push(git.code === 0 ? "ok      git" : "warn    git not found (the image tag falls back to \"latest\")");

  if (selected.some(({ target }) => target.type === "docker")) {
    const docker = await deps.runner.capture("docker", ["version", "--format", "{{.Server.Version}}"], context.cwd);
    if (docker.code === 0) {
      lines.push(`ok      docker ${docker.stdout.trim()}`);
    } else {
      failed = true;
      lines.push("missing docker (not installed, or the daemon isn't running)");
    }
  }

  for (const { name, target } of selected) {
    const needed = [...target.env, ...(target.registry ? [target.registry.usernameEnv, target.registry.passwordEnv] : [])];
    for (const variable of needed) {
      lines.push(
        deps.env[variable]
          ? `ok      ${name}: ${variable} is set`
          : `warn    ${name}: ${variable} is not set here (fine for CI, which supplies it from secrets)`,
      );
    }
  }

  return { exitCode: failed ? 1 : 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}

export type { Step };
