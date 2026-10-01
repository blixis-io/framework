import { spawn } from "node:child_process";
import type { CaptureResult, Runner, Step } from "./types.js";

/** `$ cmd arg ...` for `--dry-run` and progress output. Arguments with spaces or quotes are single-quoted; a bare `$NAME` placeholder (a variable the run would supply) is left alone so it reads as one. */
const SAFE_ARGUMENT = /^(?:[\w@%+=:,./-]+|\$[A-Z_][A-Z0-9_]*)$/;

function quote(value: string): string {
  return SAFE_ARGUMENT.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

export function formatStep(step: Step): string {
  // A shell step's command is already a command line the user wrote; quoting it would misrepresent what runs.
  const line = step.shell ? [step.command, ...step.args].join(" ") : [step.command, ...step.args].map(quote).join(" ");
  const withEnv = step.env ? `${Object.entries(step.env).map(([key, value]) => `${key}=${quote(value)}`).join(" ")} ${line}` : line;
  return step.stdinFromEnv ? `printenv ${step.stdinFromEnv} | ${withEnv}` : withEnv;
}

/** Real process runner: output streams straight to the terminal. */
export const processRunner: Runner = {
  run(step) {
    return new Promise((resolve, reject) => {
      const child = spawn(step.command, [...step.args], {
        cwd: step.cwd,
        env: { ...process.env, ...step.env },
        stdio: [step.stdinFromEnv ? "pipe" : "inherit", "inherit", "inherit"],
        shell: step.shell === true,
      });
      if (step.stdinFromEnv) {
        child.stdin?.end(process.env[step.stdinFromEnv] ?? "");
      }
      child.once("error", reject);
      child.once("close", (code) => {
        resolve(code ?? 1);
      });
    });
  },

  capture(command, args, cwd) {
    return new Promise<CaptureResult>((resolve) => {
      let stdout = "";
      const child = spawn(command, [...args], { cwd, stdio: ["ignore", "pipe", "ignore"] });
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      // A missing binary (ENOENT) is "not available", not a crash.
      child.once("error", () => {
        resolve({ code: 127, stdout: "" });
      });
      child.once("close", (code) => {
        resolve({ code: code ?? 1, stdout });
      });
    });
  },
};
