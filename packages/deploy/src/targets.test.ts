import { describe, expect, it } from "vitest";
import { parseDeployConfig, type DockerTarget } from "./config.js";
import { fakeRunner } from "./test-helpers.js";
import { adapterFor, dockerAdapter } from "./targets.js";

function target(extra: Record<string, unknown> = {}): DockerTarget {
  const config = parseDeployConfig({ path: "p", config: { deploy: { targets: { prod: { type: "docker", image: "ghcr.io/acme/api", ...extra } } } } });
  const parsed = config.targets["prod"];
  if (parsed?.type !== "docker") {
    throw new Error("expected a docker target");
  }
  return parsed;
}

const ctx = { cwd: "/app", env: {}, tag: "abc123" };

describe("dockerAdapter.resolveTag", () => {
  it("prefers the configured tag", async () => {
    await expect(dockerAdapter.resolveTag(target({ tag: "v1" }), { BLIX_TAG: "env" }, "/app", fakeRunner())).resolves.toBe("v1");
  });

  it("then BLIX_TAG", async () => {
    await expect(dockerAdapter.resolveTag(target(), { BLIX_TAG: "from-env" }, "/app", fakeRunner())).resolves.toBe("from-env");
  });

  it("then the short git commit", async () => {
    const runner = fakeRunner({ captures: { "git rev-parse --short HEAD": { code: 0, stdout: "d34db33\n" } } });

    await expect(dockerAdapter.resolveTag(target(), {}, "/app", runner)).resolves.toBe("d34db33");
  });

  it("falls back to latest when git has nothing", async () => {
    await expect(dockerAdapter.resolveTag(target(), {}, "/app", fakeRunner())).resolves.toBe("latest");
    const empty = fakeRunner({ captures: { "git rev-parse --short HEAD": { code: 0, stdout: "  \n" } } });
    await expect(dockerAdapter.resolveTag(target(), {}, "/app", empty)).resolves.toBe("latest");
  });
});

describe("dockerAdapter.plan", () => {
  it("a build-only plan is just the docker build", () => {
    const plan = dockerAdapter.plan("prod", target({ registry: { host: "ghcr.io" }, after: "echo hi" }), "build", ctx);

    expect(plan.steps.map((step) => [step.command, ...step.args])).toEqual([["docker", "build", "-t", "ghcr.io/acme/api:abc123", "-f", "Dockerfile", "."]]);
    expect(plan.missingEnv).toEqual([]);
  });

  it("a full deploy logs in, builds, pushes and runs the post-push command", () => {
    const env = { REGISTRY_USERNAME: "bot", REGISTRY_PASSWORD: "pw" };
    const plan = dockerAdapter.plan("prod", target({ registry: { host: "ghcr.io" }, after: 'fly deploy --image "$BLIX_IMAGE"' }), "deploy", { ...ctx, env });

    expect(plan.steps.map((step) => step.name)).toEqual([
      "log in to ghcr.io",
      "build ghcr.io/acme/api:abc123",
      "push ghcr.io/acme/api:abc123",
      "run the post-push command",
    ]);
    expect(plan.steps[0]).toMatchObject({ args: ["login", "ghcr.io", "-u", "bot", "--password-stdin"], stdinFromEnv: "REGISTRY_PASSWORD" });
    expect(plan.steps[3]).toMatchObject({ shell: true, env: { BLIX_IMAGE: "ghcr.io/acme/api:abc123", BLIX_TAG: "abc123" } });
    expect(plan.missingEnv).toEqual([]);
  });

  it("the password never appears in any step's arguments", () => {
    const env = { REGISTRY_USERNAME: "bot", REGISTRY_PASSWORD: "hunter2" };
    const plan = dockerAdapter.plan("prod", target({ registry: { host: "ghcr.io" } }), "deploy", { ...ctx, env });

    expect(JSON.stringify(plan.steps)).not.toContain("hunter2");
  });

  it("reports missing credentials and required variables, using $NAME placeholders in the plan", () => {
    const plan = dockerAdapter.plan("prod", target({ registry: { host: "ghcr.io" }, env: ["API_TOKEN"] }), "deploy", ctx);

    expect(plan.missingEnv.toSorted()).toEqual(["API_TOKEN", "REGISTRY_PASSWORD", "REGISTRY_USERNAME"]);
    expect(plan.steps[0]?.args).toContain("$REGISTRY_USERNAME");
  });

  it("honours custom credential variable names, dockerfile, context and platform", () => {
    const plan = dockerAdapter.plan(
      "prod",
      target({ registry: { host: "r.io", usernameEnv: "U", passwordEnv: "P" }, dockerfile: "docker/App.Dockerfile", context: "apps/api", platform: "linux/amd64" }),
      "deploy",
      { ...ctx, env: { U: "u", P: "p" } },
    );

    expect(plan.steps[0]).toMatchObject({ args: ["login", "r.io", "-u", "u", "--password-stdin"], stdinFromEnv: "P" });
    expect(plan.steps[1]?.args).toEqual(["build", "-t", "ghcr.io/acme/api:abc123", "-f", "docker/App.Dockerfile", "--platform", "linux/amd64", "apps/api"]);
  });

  it("skips login and push when push is false", () => {
    const plan = dockerAdapter.plan("prod", target({ push: false, registry: { host: "ghcr.io" } }), "deploy", ctx);

    expect(plan.steps.map((step) => step.name)).toEqual(["build ghcr.io/acme/api:abc123"]);
    expect(plan.missingEnv).toEqual([]);
  });
});

describe("adapterFor", () => {
  it("binds the docker adapter to a docker target", () => {
    expect(adapterFor("prod", target()).plan("build", ctx).steps[0]?.command).toBe("docker");
  });
});
