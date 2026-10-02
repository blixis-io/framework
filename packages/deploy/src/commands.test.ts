import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedConfig } from "@blixis-io/cli";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDeploy, USAGE, type DeployDeps } from "./commands.js";
import { imageFromRemote, registryHostOf } from "./docker.js";
import { fakeRunner, type FakeRunner } from "./test-helpers.js";

let cwd: string;
let logs: string[];

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "blix-deploy-test-"));
  logs = [];
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const config = (deploy: unknown): LoadedConfig => ({ path: "/p/blix.config.ts", config: { deploy } });
const prod = { targets: { prod: { type: "docker", image: "ghcr.io/acme/api", registry: { host: "ghcr.io" } } } };
const fullEnv = { REGISTRY_USERNAME: "bot", REGISTRY_PASSWORD: "pw" };
const GIT_SHA = { "git rev-parse --short HEAD": { code: 0, stdout: "abc1234\n" } };

function deps(runner: FakeRunner, env: DeployDeps["env"] = {}): DeployDeps {
  return {
    runner,
    env,
    log: (line) => {
      logs.push(line);
    },
  };
}

const run = (args: string[], loaded: LoadedConfig | undefined, d: DeployDeps) => runDeploy({ args, cwd, config: loaded }, d);

describe("blix deploy --dry-run", () => {
  it("prints every command and runs none", async () => {
    const runner = fakeRunner({ captures: GIT_SHA });

    const result = await run(["--dry-run"], config(prod), deps(runner, fullEnv));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "# deploy prod (docker), tag abc1234",
        "$ printenv REGISTRY_PASSWORD | docker login ghcr.io -u bot --password-stdin",
        "$ docker build -t ghcr.io/acme/api:abc1234 -f Dockerfile .",
        "$ docker push ghcr.io/acme/api:abc1234",
        "",
      ].join("\n"),
    );
    expect(runner.ran).toEqual([]);
  });

  it("lists missing environment variables without failing", async () => {
    const result = await run(["--dry-run"], config(prod), deps(fakeRunner()));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("$ printenv REGISTRY_PASSWORD | docker login ghcr.io -u $REGISTRY_USERNAME --password-stdin");
    expect(result.stdout).toContain("# would need these environment variables: REGISTRY_USERNAME, REGISTRY_PASSWORD");
  });
});

describe("blix deploy", () => {
  it("runs each step in order and reports the result", async () => {
    const runner = fakeRunner({ captures: GIT_SHA });

    const result = await run([], config(prod), deps(runner, fullEnv));

    expect(runner.ran.map((step) => step.name)).toEqual(["log in to ghcr.io", "build ghcr.io/acme/api:abc1234", "push ghcr.io/acme/api:abc1234"]);
    expect(result).toEqual({ exitCode: 0, stdout: "\nDeployed prod (docker), tag abc1234.\n", stderr: "" });
    expect(logs.join("")).toContain("> build ghcr.io/acme/api:abc1234");
  });

  it("never logs the registry password", async () => {
    await run([], config(prod), deps(fakeRunner(), { ...fullEnv, REGISTRY_PASSWORD: "hunter2" }));

    expect(logs.join("")).not.toContain("hunter2");
  });

  it("stops at the first failing step and says which", async () => {
    const runner = fakeRunner({ captures: GIT_SHA, failStep: "build ghcr.io/acme/api:abc1234" });

    const result = await run([], config(prod), deps(runner, fullEnv));

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("Step failed (exit 2): build ghcr.io/acme/api:abc1234\n");
    expect(runner.ran.map((step) => step.name)).not.toContain("push ghcr.io/acme/api:abc1234");
  });

  it("refuses to start when required environment variables are missing", async () => {
    const runner = fakeRunner();

    const result = await run([], config(prod), deps(runner, { REGISTRY_USERNAME: "bot" }));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing environment variables for prod: REGISTRY_PASSWORD");
    expect(runner.ran).toEqual([]);
  });

  it("deploys the named target", async () => {
    const two = { targets: { prod: prod.targets.prod, staging: { type: "docker", image: "ghcr.io/acme/api-staging", push: false } } };
    const runner = fakeRunner();

    await run(["staging"], config(two), deps(runner));

    expect(runner.ran.map((step) => step.name)).toEqual(["build ghcr.io/acme/api-staging:latest"]);
  });

  it("runs the post-push command with BLIX_IMAGE set", async () => {
    const withThen = { targets: { prod: { ...prod.targets.prod, after: 'fly deploy --image "$BLIX_IMAGE"' } } };
    const runner = fakeRunner({ captures: GIT_SHA });

    await run([], config(withThen), deps(runner, fullEnv));

    expect(runner.ran.at(-1)).toMatchObject({ command: 'fly deploy --image "$BLIX_IMAGE"', shell: true, env: { BLIX_IMAGE: "ghcr.io/acme/api:abc1234" } });
  });

  it("turns config problems into a clean error", async () => {
    const result = await run([], undefined, deps(fakeRunner()));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No blix.config.ts found");
  });

  it("shows usage for --help, and for a bare call with no config at all", async () => {
    expect((await run(["--help"], undefined, deps(fakeRunner()))).stdout).toBe(USAGE);
  });

  it("rejects an unknown option and a flag missing its value", async () => {
    expect((await run(["--bogus"], config(prod), deps(fakeRunner()))).stderr).toContain("Unknown option --bogus");
    expect((await run(["init", "--ci"], config(prod), deps(fakeRunner()))).stderr).toContain("--ci needs a value");
    expect((await run(["init", "--image", "--force"], config(prod), deps(fakeRunner()))).stderr).toContain("--image needs a value");
  });
});

describe("blix deploy build", () => {
  it("only builds: no login, push or post-push command, and no credentials needed", async () => {
    const withThen = { targets: { prod: { ...prod.targets.prod, after: "echo hi" } } };
    const runner = fakeRunner({ captures: GIT_SHA });

    const result = await run(["build"], config(withThen), deps(runner, {}));

    expect(runner.ran.map((step) => step.name)).toEqual(["build ghcr.io/acme/api:abc1234"]);
    expect(result.stdout).toBe("\nBuilt prod (docker), tag abc1234.\n");
  });

  it("supports --dry-run and a target name", async () => {
    const result = await run(["build", "prod", "--dry-run"], config(prod), deps(fakeRunner()));

    expect(result.stdout).toBe("# build prod (docker), tag latest\n$ docker build -t ghcr.io/acme/api:latest -f Dockerfile .\n");
  });
});

describe("blix deploy init", () => {
  const gitRemote = { "git remote get-url origin": { code: 0, stdout: "git@github.com:Acme/My-Api.git\n" } };

  it("writes the config, a Dockerfile, .dockerignore and the workflow", async () => {
    writeFileSync(join(cwd, "pnpm-lock.yaml"), "");

    const result = await run(["init", "--ci", "github"], undefined, deps(fakeRunner({ captures: gitRemote })));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("created blix.config.ts");
    expect(result.stdout).toContain("created Dockerfile");
    expect(result.stdout).toContain("created .dockerignore");
    expect(result.stdout).toContain("created .github/workflows/deploy.yml");
    const written = readFileSync(join(cwd, "blix.config.ts"), "utf8");
    expect(written).toContain('image: "ghcr.io/acme/my-api"');
    expect(written).toContain('registry: { host: "ghcr.io" }');
    expect(readFileSync(join(cwd, "Dockerfile"), "utf8")).toContain("pnpm install --frozen-lockfile");
    expect(readFileSync(join(cwd, ".github/workflows/deploy.yml"), "utf8")).toContain("pnpm exec blix deploy prod");
  });

  it("warns when a pnpm project doesn't pin its package manager, and stays quiet when it does", async () => {
    writeFileSync(join(cwd, "pnpm-lock.yaml"), "");
    writeFileSync(join(cwd, "package.json"), '{"name":"x"}');
    const unpinned = await run(["init"], undefined, deps(fakeRunner()));
    expect(unpinned.stdout).toContain('package.json has no "packageManager" field');

    rmSync(join(cwd, "blix.config.ts"));
    writeFileSync(join(cwd, "package.json"), '{"name":"x","packageManager":"pnpm@11.25.0"}');
    const pinned = await run(["init", "--force"], undefined, deps(fakeRunner()));
    expect(pinned.stdout).not.toContain("packageManager");
  });

  it("treats a missing or unreadable package.json as unpinned", async () => {
    writeFileSync(join(cwd, "pnpm-lock.yaml"), "");
    writeFileSync(join(cwd, "package.json"), "{nope");

    expect((await run(["init"], undefined, deps(fakeRunner()))).stdout).toContain('no "packageManager" field');
  });

  it("uses an explicit --image and derives the registry host from it", async () => {
    await run(["init", "--image", "registry.example.com:5000/team/api"], undefined, deps(fakeRunner()));

    const written = readFileSync(join(cwd, "blix.config.ts"), "utf8");
    expect(written).toContain('image: "registry.example.com:5000/team/api"');
    expect(written).toContain('registry: { host: "registry.example.com:5000" }');
  });

  it("falls back to a placeholder namespace and says so", async () => {
    const result = await run(["init"], undefined, deps(fakeRunner()));

    expect(result.stdout).toContain("couldn't work out your registry namespace");
    expect(readFileSync(join(cwd, "blix.config.ts"), "utf8")).toContain("ghcr.io/OWNER/");
  });

  it("never overwrites existing files without --force", async () => {
    writeFileSync(join(cwd, "Dockerfile"), "MINE");
    writeFileSync(join(cwd, "blix.config.ts"), "export default {};\n");
    writeFileSync(join(cwd, ".dockerignore"), "MINE");

    const result = await run(["init"], undefined, deps(fakeRunner()));

    expect(result.stdout).toContain("kept blix.config.ts");
    expect(result.stdout).toContain("kept Dockerfile");
    expect(result.stdout).toContain("kept .dockerignore");
    expect(readFileSync(join(cwd, "Dockerfile"), "utf8")).toBe("MINE");
    expect(readFileSync(join(cwd, "blix.config.ts"), "utf8")).toBe("export default {};\n");
  });

  it("--force overwrites the Dockerfile and the workflow", async () => {
    writeFileSync(join(cwd, "Dockerfile"), "MINE");

    const result = await run(["init", "--force"], undefined, deps(fakeRunner()));

    expect(result.stdout).toContain("overwrote Dockerfile");
    expect(readFileSync(join(cwd, "Dockerfile"), "utf8")).toContain("FROM node:24-alpine");
  });

  it("rejects a target type that isn't supported, and an unknown CI provider", async () => {
    const unsupported = await run(["init", "--target", "ftp"], undefined, deps(fakeRunner()));
    expect(unsupported.stderr).toContain('Unsupported target "ftp". Supported: docker, vercel, netlify, cloudflare.');
    expect((await run(["init", "--ci", "travis"], undefined, deps(fakeRunner()))).stderr).toContain('Unknown CI provider "travis"');
  });

  it("explains how to proceed on yarn/bun, which have no Dockerfile template", async () => {
    writeFileSync(join(cwd, "yarn.lock"), "");

    const result = await run(["init"], undefined, deps(fakeRunner()));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('set "dockerfile"');
  });

  it("accepts --flag=value, --branch and --entry", async () => {
    await run(["init", "--ci=github", "--branch=release", "--entry=dist/server.js"], undefined, deps(fakeRunner()));

    expect(readFileSync(join(cwd, ".github/workflows/deploy.yml"), "utf8")).toContain("branches: [release]");
    expect(readFileSync(join(cwd, "Dockerfile"), "utf8")).toContain('"dist/server.js"');
  });
});

describe("blix deploy init for Vercel and Netlify", () => {
  it("vercel: writes config, entry, vercel.json and public/, and a workflow with the Vercel secrets", async () => {
    const result = await run(["init", "--target", "vercel", "--ci", "github"], undefined, deps(fakeRunner()));

    expect(result.exitCode).toBe(0);
    const written = ["blix.config.ts", "api/index.mjs", "vercel.json", "public/.gitkeep", ".github/workflows/deploy.yml"].filter((file) =>
      existsSync(join(cwd, file)),
    );
    expect(written).toEqual(["blix.config.ts", "api/index.mjs", "vercel.json", "public/.gitkeep", ".github/workflows/deploy.yml"]);
    expect(existsSync(join(cwd, "Dockerfile"))).toBe(false);
    expect(readFileSync(join(cwd, "blix.config.ts"), "utf8")).toContain('type: "vercel"');
    expect(readFileSync(join(cwd, "api/index.mjs"), "utf8")).toContain('from "../dist/app.module.js"');
    const workflow = readFileSync(join(cwd, ".github/workflows/deploy.yml"), "utf8");
    expect(workflow).toContain("VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}");
    expect(workflow).toContain("VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}");
    expect(workflow).not.toContain("packages: write");
    expect(result.stdout).toContain("note: the function entry uses createFetchHandler");
  });

  it("netlify: writes the function and netlify.toml, with the app module configurable", async () => {
    await run(["init", "--target", "netlify", "--app-module", "build/root.js", "--app-export", "RootModule"], undefined, deps(fakeRunner()));

    expect(readFileSync(join(cwd, "netlify/functions/api.mjs"), "utf8")).toContain('import { RootModule } from "../../build/root.js";');
    expect(readFileSync(join(cwd, "netlify.toml"), "utf8")).toContain('functions = "netlify/functions"');
  });

  it("keeps an existing public/.gitkeep even with --force, and overwrites the entry", async () => {
    mkdirSync(join(cwd, "public"), { recursive: true });
    writeFileSync(join(cwd, "public/.gitkeep"), "MINE");
    mkdirSync(join(cwd, "api"), { recursive: true });
    writeFileSync(join(cwd, "api/index.mjs"), "OLD");

    const result = await run(["init", "--target", "vercel", "--force"], undefined, deps(fakeRunner()));

    expect(result.stdout).toContain("kept public/.gitkeep");
    expect(result.stdout).toContain("overwrote api/index.mjs");
    expect(readFileSync(join(cwd, "public/.gitkeep"), "utf8")).toBe("MINE");
  });

  it("--name picks the target name, and a reserved name is refused", async () => {
    await run(["init", "--target", "vercel", "--name", "preview", "--ci", "github"], undefined, deps(fakeRunner()));

    expect(readFileSync(join(cwd, "blix.config.ts"), "utf8")).toContain("preview: {");
    expect(readFileSync(join(cwd, ".github/workflows/deploy.yml"), "utf8")).toContain("blix deploy preview");
    expect((await run(["init", "--name", "build"], undefined, deps(fakeRunner()))).stderr).toContain(`"build" can't be a target name`);
  });

  it("with an existing config, prints the target to add instead of touching the file", async () => {
    writeFileSync(join(cwd, "blix.config.ts"), "export default {};\n");

    const result = await run(["init", "--target", "netlify", "--name", "docs"], undefined, deps(fakeRunner()));

    expect(result.stdout).toContain("kept blix.config.ts. Add this under deploy.targets yourself:");
    expect(result.stdout).toContain('      docs: {\n        type: "netlify",');
    expect(readFileSync(join(cwd, "blix.config.ts"), "utf8")).toBe("export default {};\n");
  });
});

describe("blix deploy init for Cloudflare", () => {
  it("writes the Worker entry and a wrangler.toml named after the package, with nodejs_compat", async () => {
    writeFileSync(join(cwd, "package.json"), '{"name":"@acme/My_Orders_API"}');

    const result = await run(["init", "--target", "cloudflare", "--ci", "github"], undefined, deps(fakeRunner()));

    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(cwd, "cloudflare/worker.mjs"), "utf8")).toContain('import { AppModule } from "../dist/app.module.js";');
    const wrangler = readFileSync(join(cwd, "wrangler.toml"), "utf8");
    expect(wrangler).toContain('name = "my-orders-api"');
    expect(wrangler).toContain('main = "cloudflare/worker.mjs"');
    expect(wrangler).toContain('compatibility_flags = ["nodejs_compat"]');
    expect(wrangler).toMatch(/compatibility_date = "\d{4}-\d{2}-\d{2}"/);
    expect(readFileSync(join(cwd, "blix.config.ts"), "utf8")).toContain('type: "cloudflare"');
    const workflow = readFileSync(join(cwd, ".github/workflows/deploy.yml"), "utf8");
    expect(workflow).toContain("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}");
    expect(workflow).toContain("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}");
    expect(result.stdout).toContain("note: the Worker entry uses createFetchHandler");
    expect(result.stdout).toContain("nodejs_compat");
  });

  it("deploys with wrangler: build, then npx wrangler deploy (dry run)", async () => {
    const cf = { default: "edge", targets: { edge: { type: "cloudflare", environment: "staging", config: "wrangler.jsonc" } } };

    const result = await run(["--dry-run"], config(cf), deps(fakeRunner()));

    expect(result.stdout).toBe("# deploy edge (cloudflare), tag latest\n$ npm run build\n$ npx --yes wrangler@latest deploy --config wrangler.jsonc --env staging\n");
  });

  it("GitLab and Bitbucket jobs for Cloudflare have no Docker part and list the credentials", async () => {
    const cf = { targets: { edge: { type: "cloudflare" } } };

    await run(["ci", "gitlab"], config(cf), deps(fakeRunner()));
    await run(["ci", "bitbucket"], config(cf), deps(fakeRunner()));

    const gitlab = readFileSync(join(cwd, ".gitlab-ci.yml"), "utf8");
    expect(gitlab).not.toContain("dind");
    expect(gitlab).toContain("#   CLOUDFLARE_API_TOKEN");
    expect(readFileSync(join(cwd, "bitbucket-pipelines.yml"), "utf8")).toContain("#   CLOUDFLARE_ACCOUNT_ID");
  });
});

describe("blix deploy for Vercel and Netlify (planning)", () => {
  const providers = {
    default: "v",
    targets: { v: { type: "vercel" }, n: { type: "netlify", site: "site-1", production: false, env: ["API_KEY"] } },
  };

  it("--dry-run shows the build then the provider command", async () => {
    writeFileSync(join(cwd, "pnpm-lock.yaml"), "");
    const vercel = await run(["v", "--dry-run"], config(providers), deps(fakeRunner()));
    const netlify = await run(["n", "--dry-run"], config(providers), deps(fakeRunner()));

    expect(vercel.stdout).toBe("# deploy v (vercel), tag latest\n$ pnpm run build\n$ npx --yes vercel@latest deploy --yes --prod\n");
    expect(netlify.stdout).toContain("$ npx --yes netlify-cli@latest deploy --dir public --functions netlify/functions --site site-1\n");
    expect(netlify.stdout).toContain("# would need these environment variables: API_KEY");
  });

  it("a real deploy refuses to start without a variable the target lists", async () => {
    const runner = fakeRunner();

    const result = await run(["n"], config(providers), deps(runner, {}));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing environment variables for n: API_KEY");
    expect(runner.ran).toEqual([]);
  });

  it("runs the build then the deploy, in order", async () => {
    const runner = fakeRunner();

    const result = await run(["v"], config(providers), deps(runner));

    expect(runner.ran.map((step) => step.name)).toEqual(["build the project", "deploy to Vercel"]);
    expect(result.stdout).toBe("\nDeployed v (vercel), tag latest.\n");
  });

  it("ci generates the workflow with each provider's secrets", async () => {
    await run(["ci", "github", "n"], config(providers), deps(fakeRunner()));

    const yaml = readFileSync(join(cwd, ".github/workflows/deploy.yml"), "utf8");
    expect(yaml).toContain("NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}");
    expect(yaml).toContain("API_KEY: ${{ secrets.API_KEY }}");
    expect(yaml).not.toContain("NETLIFY_SITE_ID");
  });

  it("doctor checks npx for provider targets and lists their credentials", async () => {
    const runner = fakeRunner({ captures: { "npx --version": { code: 0, stdout: "11.0.0\n" } } });

    const result = await run(["doctor", "v"], config(providers), deps(runner, { VERCEL_TOKEN: "t" }));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ok      npx 11.0.0");
    expect(result.stdout).toContain("ok      v: VERCEL_TOKEN is set");
    expect(result.stdout).toContain("warn    v: VERCEL_ORG_ID is not set here");
  });

  it("doctor fails when npx is missing", async () => {
    const result = await run(["doctor", "v"], config(providers), deps(fakeRunner()));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("missing npx");
  });
});

describe("blix deploy with GitLab CI and Bitbucket Pipelines", () => {
  it("init --ci gitlab writes .gitlab-ci.yml with a Docker service for a docker target", async () => {
    const result = await run(["init", "--ci", "gitlab", "--image", "registry.gitlab.com/acme/api"], undefined, deps(fakeRunner()));

    expect(result.stdout).toContain("created .gitlab-ci.yml");
    const yaml = readFileSync(join(cwd, ".gitlab-ci.yml"), "utf8");
    expect(yaml).toContain("- docker:27-dind");
    expect(yaml).toContain("REGISTRY_USERNAME: $CI_REGISTRY_USER");
    expect(yaml).toContain("blix deploy prod");
  });

  it("init --target vercel --ci bitbucket writes bitbucket-pipelines.yml without a Docker service", async () => {
    await run(["init", "--target", "vercel", "--ci", "bitbucket"], undefined, deps(fakeRunner()));

    const yaml = readFileSync(join(cwd, "bitbucket-pipelines.yml"), "utf8");
    expect(yaml).not.toContain("docker");
    expect(yaml).toContain("#   VERCEL_TOKEN");
    expect(yaml).toContain("blix deploy prod");
  });

  it("ci gitlab / ci bitbucket regenerate the file for a configured target", async () => {
    const withEnv = { targets: { prod: { ...prod.targets.prod, env: ["FLY_API_TOKEN"] } } };

    const gitlab = await run(["ci", "gitlab"], config(withEnv), deps(fakeRunner()));
    const bitbucket = await run(["ci", "bitbucket"], config(withEnv), deps(fakeRunner()));

    expect(gitlab.stdout).toBe("created .gitlab-ci.yml\n");
    expect(bitbucket.stdout).toBe("created bitbucket-pipelines.yml\n");
    expect(readFileSync(join(cwd, ".gitlab-ci.yml"), "utf8")).toContain("#   FLY_API_TOKEN");
    expect(readFileSync(join(cwd, "bitbucket-pipelines.yml"), "utf8")).toContain("services:\n            - docker");
  });

  it("lists all three providers when one is unknown", async () => {
    expect((await run(["ci", "travis"], config(prod), deps(fakeRunner()))).stderr).toContain("Providers: github, gitlab, bitbucket.");
  });
});

describe("blix deploy ci", () => {
  it("generates the workflow for a configured target, including its required variables", async () => {
    const withEnv = { targets: { prod: { ...prod.targets.prod, env: ["FLY_API_TOKEN"] } } };

    const result = await run(["ci", "github"], config(withEnv), deps(fakeRunner()));

    expect(result.stdout).toBe("created .github/workflows/deploy.yml\n");
    const yaml = readFileSync(join(cwd, ".github/workflows/deploy.yml"), "utf8");
    expect(yaml).toContain("FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}");
    expect(yaml).toContain("blix deploy prod");
  });

  it("refuses to overwrite an existing workflow without --force", async () => {
    mkdirSync(join(cwd, ".github/workflows"), { recursive: true });
    writeFileSync(join(cwd, ".github/workflows/deploy.yml"), "MINE");

    const refused = await run(["ci", "github"], config(prod), deps(fakeRunner()));
    const forced = await run(["ci", "github", "--force"], config(prod), deps(fakeRunner()));

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("already exists. Pass --force");
    expect(forced.stdout).toBe("overwrote .github/workflows/deploy.yml\n");
  });

  it("rejects a missing or unknown provider", async () => {
    expect((await run(["ci"], config(prod), deps(fakeRunner()))).stderr).toContain("Usage: blix deploy ci <provider>");
    expect((await run(["ci", "travis"], config(prod), deps(fakeRunner()))).stderr).toContain('Unknown CI provider "travis"');
  });
});

describe("blix deploy doctor", () => {
  it("reports what is available and what's missing from this environment", async () => {
    const runner = fakeRunner({
      captures: { "git --version": { code: 0, stdout: "git version 2" }, "docker version --format {{.Server.Version}}": { code: 0, stdout: "29.4.0\n" } },
    });

    const result = await run(["doctor"], config(prod), deps(runner, { REGISTRY_USERNAME: "bot" }));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ok      config: prod");
    expect(result.stdout).toContain("ok      git");
    expect(result.stdout).toContain("ok      docker 29.4.0");
    expect(result.stdout).toContain("ok      prod: REGISTRY_USERNAME is set");
    expect(result.stdout).toContain("warn    prod: REGISTRY_PASSWORD is not set here");
  });

  it("fails when docker is missing, and warns about git", async () => {
    const result = await run(["doctor", "prod"], config(prod), deps(fakeRunner()));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("missing docker");
    expect(result.stdout).toContain("warn    git not found");
  });
});

describe("helpers", () => {
  it.each([
    ["git@github.com:Acme/Api.git", "ghcr.io/acme/api"],
    ["https://github.com/Acme/Api.git\n", "ghcr.io/acme/api"],
    ["https://github.com/acme/api", "ghcr.io/acme/api"],
    ["https://gitlab.com/acme/api.git", undefined],
  ])("imageFromRemote(%j) -> %s", (url, expected) => {
    expect(imageFromRemote(url)).toBe(expected);
  });

  it.each([
    ["ghcr.io/acme/api", "ghcr.io"],
    ["registry.example.com:5000/api", "registry.example.com:5000"],
    ["localhost/api", "localhost"],
    ["acme/api", "docker.io"],
    ["api", "docker.io"],
  ])("registryHostOf(%s) -> %s", (image, expected) => {
    expect(registryHostOf(image)).toBe(expected);
  });
});

describe("the init output for a fresh project is deployable end to end (dry run)", () => {
  it("init then deploy --dry-run agree", async () => {
    await run(["init", "--image", "ghcr.io/acme/api"], undefined, deps(fakeRunner()));
    expect(existsSync(join(cwd, "blix.config.ts"))).toBe(true);
  });
});
