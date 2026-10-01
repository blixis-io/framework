import { describe, expect, it } from "vitest";
import { formatStep, processRunner } from "./runner.js";

describe("formatStep", () => {
  it("joins the command and arguments", () => {
    expect(formatStep({ name: "x", command: "docker", args: ["build", "-t", "img:1", "."] })).toBe("docker build -t img:1 .");
  });

  it("single-quotes arguments with spaces or quotes", () => {
    expect(formatStep({ name: "x", command: "echo", args: ["a b", "it's"] })).toBe("echo 'a b' 'it'\\''s'");
  });

  it("leaves a bare $NAME placeholder unquoted, but quotes anything else containing $", () => {
    expect(formatStep({ name: "x", command: "docker", args: ["-u", "$REGISTRY_USERNAME", "$HOME/x", "a$b"] })).toBe("docker -u $REGISTRY_USERNAME '$HOME/x' 'a$b'");
  });

  it("prints a shell step's command line as written, not quoted", () => {
    expect(formatStep({ name: "x", command: 'fly deploy --image "$BLIX_IMAGE"', args: [], shell: true, env: { BLIX_TAG: "t" } })).toBe(
      'BLIX_TAG=t fly deploy --image "$BLIX_IMAGE"',
    );
  });

  it("prefixes environment assignments", () => {
    expect(formatStep({ name: "x", command: "run", args: [], env: { A: "1", B: "two words" } })).toBe("A=1 B='two words' run");
  });

  it("shows a stdin pipe from an environment variable without ever printing its value", () => {
    expect(formatStep({ name: "x", command: "docker", args: ["login", "--password-stdin"], stdinFromEnv: "TOKEN" })).toBe(
      "printenv TOKEN | docker login --password-stdin",
    );
  });
});

describe("processRunner", () => {
  it("run resolves with the exit code of the real process", async () => {
    await expect(processRunner.run({ name: "ok", command: "node", args: ["-e", "process.exit(0)"] })).resolves.toBe(0);
    await expect(processRunner.run({ name: "bad", command: "node", args: ["-e", "process.exit(4)"] })).resolves.toBe(4);
  });

  it("run feeds an environment variable to stdin and passes step env through", async () => {
    const script = "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.exit(d==='s3cret'&&process.env.EXTRA==='1'?0:9))";
    process.env["BLIX_TEST_SECRET"] = "s3cret";

    const code = await processRunner.run({
      name: "stdin",
      command: "node",
      args: ["-e", script],
      stdinFromEnv: "BLIX_TEST_SECRET",
      env: { EXTRA: "1" },
    });

    delete process.env["BLIX_TEST_SECRET"];
    expect(code).toBe(0);
  });

  it("run can execute a shell command line", async () => {
    await expect(processRunner.run({ name: "sh", command: "exit 5", args: [], shell: true })).resolves.toBe(5);
  });

  it("capture returns stdout and the exit code", async () => {
    await expect(processRunner.capture("node", ["-e", "console.log('hi')"], process.cwd())).resolves.toEqual({ code: 0, stdout: "hi\n" });
  });

  it("capture reports a missing command as exit 127 instead of throwing", async () => {
    await expect(processRunner.capture("blix-no-such-command-xyz", [], process.cwd())).resolves.toEqual({ code: 127, stdout: "" });
  });
});
