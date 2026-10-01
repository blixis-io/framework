import type { DockerTarget } from "./config.js";
import { DOCKERIGNORE, renderDockerfile } from "./dockerfile.js";
import { gitTag, type InitContext, type InitPlan, type TargetAdapter } from "./target-types.js";
import type { Step } from "./types.js";

export const dockerAdapter: TargetAdapter<DockerTarget> = {
  type: "docker",

  async resolveTag(target, env, cwd, runner) {
    return target.tag ?? (await gitTag(env, cwd, runner));
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
      args: ["build", "-t", image, "-f", target.dockerfile, ...(target.platform ? ["--platform", target.platform] : []), target.context],
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

  ci: (target) => ({ secrets: target.env, registry: target.registry }),
};

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

export async function initDocker({ cwd, packageManager, runner, options }: InitContext): Promise<InitPlan> {
  const notes: string[] = [];
  let image = options.image;
  if (!image) {
    const remote = await runner.capture("git", ["remote", "get-url", "origin"], cwd);
    const derived = remote.code === 0 ? imageFromRemote(remote.stdout) : undefined;
    image = derived ?? `ghcr.io/OWNER/${cwd.split(/[\\/]/).pop()?.toLowerCase() ?? "app"}`;
    if (!derived) {
      notes.push(`couldn't work out your registry namespace; edit "image" in blix.config.ts (now ${image}).`);
    }
  }

  return {
    target: { type: "docker", image, registry: { host: registryHostOf(image) } },
    comments: ['after: \'fly deploy --image "$BLIX_IMAGE"\',  // tell your host to pick up the new image'],
    files: [
      { path: "Dockerfile", content: renderDockerfile({ packageManager, entry: options.entry }) },
      { path: ".dockerignore", content: DOCKERIGNORE, keep: true },
    ],
    notes,
  };
}
