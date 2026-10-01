import { describe, expect, it } from "vitest";
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
