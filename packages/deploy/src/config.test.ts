import { describe, expect, it } from "vitest";
import { DEFAULT_CLI_VERSIONS } from "./cli-versions.js";
import { DeployConfigError, defineDeployConfig, parseDeployConfig, selectTarget } from "./config.js";

const loaded = (config: Record<string, unknown>) => ({ path: "/p/blix.config.ts", config });
const docker = { type: "docker", image: "ghcr.io/acme/api" };
const parseBroken = () => parseDeployConfig(loaded({ deploy: { targets: { prod: { type: "docker" }, other: { type: "ftp" } } } }));

describe("parseDeployConfig", () => {
  it("fills in defaults", () => {
    const config = parseDeployConfig(loaded({ deploy: { targets: { prod: docker } } }));

    expect(config.targets["prod"]).toEqual({
      type: "docker",
      image: "ghcr.io/acme/api",
      dockerfile: "Dockerfile",
      context: ".",
      push: true,
      env: [],
    });
  });

  it("fills in registry credential variable names", () => {
    const config = parseDeployConfig(loaded({ deploy: { targets: { prod: { ...docker, registry: { host: "ghcr.io" } } } } }));

    expect(config.targets["prod"]).toMatchObject({ registry: { host: "ghcr.io", usernameEnv: "REGISTRY_USERNAME", passwordEnv: "REGISTRY_PASSWORD" } });
  });

  it("explains a missing config file", () => {
    expect(() => parseDeployConfig(undefined)).toThrow("No blix.config.ts found. Run `blix deploy init`");
  });

  it("explains a config with no deploy section", () => {
    expect(() => parseDeployConfig(loaded({}))).toThrow('blix.config.ts has no "deploy" section');
  });

  it("lists every problem with its path", () => {
    expect(parseBroken).toThrow(DeployConfigError);
    expect(parseBroken).toThrow("deploy.targets.prod.image");
    expect(parseBroken).toThrow("deploy.targets.other.type");
  });

  it("rejects an empty targets map", () => {
    expect(() => parseDeployConfig(loaded({ deploy: { targets: {} } }))).toThrow("deploy.targets is empty");
  });

  it.each(["init", "build", "ci", "doctor", "help"])("rejects the reserved target name %s", (name) => {
    expect(() => parseDeployConfig(loaded({ deploy: { targets: { [name]: docker } } }))).toThrow(`"${name}" can't be a target name`);
  });

  it("rejects a default that is not a target", () => {
    expect(() => parseDeployConfig(loaded({ deploy: { default: "nope", targets: { prod: docker } } }))).toThrow('deploy.default is "nope"');
  });
});

describe("selectTarget", () => {
  const config = parseDeployConfig(loaded({ deploy: { default: "staging", targets: { prod: docker, staging: docker } } }));

  it("picks the named target", () => {
    expect(selectTarget(config, "prod").name).toBe("prod");
  });

  it("falls back to the default", () => {
    expect(selectTarget(config, undefined).name).toBe("staging");
  });

  it("picks the only target when there is no default", () => {
    const single = parseDeployConfig(loaded({ deploy: { targets: { prod: docker } } }));

    expect(selectTarget(single, undefined).name).toBe("prod");
  });

  it("asks which target when several exist and none is the default", () => {
    const several = parseDeployConfig(loaded({ deploy: { targets: { a: docker, b: docker } } }));

    expect(() => selectTarget(several, undefined)).toThrow("Which target? Pass one of: a, b");
  });

  it("rejects an unknown target, listing the real ones", () => {
    expect(() => selectTarget(config, "nope")).toThrow('Unknown target "nope". Targets: prod, staging');
  });
});

describe("defineDeployConfig", () => {
  it("returns its argument", () => {
    const input = { targets: { prod: { type: "docker" as const, image: "x" } } };
    expect(defineDeployConfig(input)).toBe(input);
  });
});

describe("selectTarget: names that are keys of Object.prototype", () => {
  it.each(["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"])("%s is an unknown target, not a target made of Object.prototype", (name) => {
    const config = parseDeployConfig(loaded({ deploy: { targets: { prod: docker } } }));

    expect(() => selectTarget(config, name)).toThrow(DeployConfigError);
    expect(() => selectTarget(config, name)).toThrow(`Unknown target "${name}"`);
  });

  it("still selects a target that is really called that", () => {
    const config = parseDeployConfig(loaded({ deploy: { targets: { constructor: docker } } }));

    expect(selectTarget(config, "constructor").name).toBe("constructor");
  });
});

const messageFor = (config: Record<string, unknown>): string => {
  try {
    parseDeployConfig(loaded(config));
  } catch (error) {
    return error instanceof DeployConfigError ? error.message : String(error);
  }
  return "";
};

describe("parseDeployConfig: unknown keys are errors, not silently dropped", () => {
  it("refuses a misspelt option, which used to be ignored and left the default in force (`pussh: false` still pushed)", () => {
    const message = messageFor({ deploy: { targets: { prod: { ...docker, pussh: false } } } });

    expect(message).toContain('deploy.targets.prod: unknown option "pussh"');
    expect(message).toContain('did you mean "push"?');
  });

  it.each([
    ["netlify", { type: "netlify", functons: "fns" }, "functons", "functions"],
    ["cloudflare", { type: "cloudflare", enviroment: "staging" }, "enviroment", "environment"],
    ["vercel", { type: "vercel", producton: false }, "producton", "production"],
    ["docker", { type: "docker", image: "a/b", dockerfle: "Other" }, "dockerfle", "dockerfile"],
  ])("suggests the right key for a typo in a %s target", (_type, target, typo, suggestion) => {
    const message = messageFor({ deploy: { targets: { t: target } } });

    expect(message).toContain(`unknown option "${typo}"`);
    expect(message).toContain(`did you mean "${suggestion}"?`);
  });

  it("checks the registry section and the deploy section too", () => {
    expect(messageFor({ deploy: { targets: { prod: { ...docker, registry: { host: "ghcr.io", passwordEnvv: "X" } } } } })).toContain('did you mean "passwordEnv"?');
    expect(messageFor({ deploy: { targest: { prod: docker } } })).toContain('did you mean "targets"?');
  });

  it("lists the known options when nothing is close enough to suggest", () => {
    const message = messageFor({ deploy: { targets: { prod: { ...docker, banana: 1 } } } });

    expect(message).toContain('unknown option "banana"');
    expect(message).not.toContain("did you mean");
    expect(message).toContain("known options:");
    expect(message).toContain("image");
  });

  it("names every unknown option at once", () => {
    const message = messageFor({ deploy: { targets: { prod: { ...docker, pussh: false, banana: 1 } } } });

    expect(message).toContain('"pussh"');
    expect(message).toContain('"banana"');
  });

  it("still accepts every documented option", () => {
    expect(() =>
      parseDeployConfig(
        loaded({
          deploy: {
            default: "prod",
            targets: {
              prod: { ...docker, registry: { host: "ghcr.io", usernameEnv: "U", passwordEnv: "P" }, dockerfile: "D", context: ".", platform: "linux/amd64", tag: "t", push: false, after: "echo", env: ["A"] },
              v: { type: "vercel", production: false, build: "b", cliVersion: "1.0.0", env: [] },
              n: { type: "netlify", dir: "d", functions: "f", site: "s" },
              c: { type: "cloudflare", environment: "e", config: "wrangler.jsonc" },
            },
          },
        }),
      ),
    ).not.toThrow();
  });
});

const targetOf = (type: string, extra: Record<string, unknown> = {}) =>
  parseDeployConfig(loaded({ deploy: { targets: { t: { type, ...extra } } } })).targets["t"];

describe("parseDeployConfig: the provider CLI version", () => {
  it.each([
    ["vercel", DEFAULT_CLI_VERSIONS.vercel],
    ["netlify", DEFAULT_CLI_VERSIONS["netlify-cli"]],
    ["cloudflare", DEFAULT_CLI_VERSIONS.wrangler],
  ])("%s defaults to a pinned version, not latest", (type, version) => {
    const target = targetOf(type);

    expect(target && "cliVersion" in target ? target.cliVersion : undefined).toBe(version);
  });

  it("keeps whatever the config says, including an explicit latest", () => {
    for (const cliVersion of ["latest", "1.2.3", "^2.0.0"]) {
      const target = targetOf("vercel", { cliVersion });

      expect(target && "cliVersion" in target ? target.cliVersion : undefined).toBe(cliVersion);
    }
  });
});
