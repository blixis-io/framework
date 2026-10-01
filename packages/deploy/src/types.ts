/** One command to run. Plans are plain lists of these, so `--dry-run` and tests never need to execute anything. */
export interface Step {
  name: string;
  command: string;
  args: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  /** Pipe the value of this environment variable to the command's stdin (e.g. `docker login --password-stdin`), so a secret never appears in argv. */
  stdinFromEnv?: string;
  /** Run through the shell (for a user-supplied command line). */
  shell?: boolean;
}

export interface CaptureResult {
  code: number;
  stdout: string;
}

/** Executes steps. Injected so tests and `--dry-run` never touch docker, git or the network. */
export interface Runner {
  run(step: Step): Promise<number>;
  capture(command: string, args: readonly string[], cwd: string): Promise<CaptureResult>;
}

export type Env = Readonly<Record<string, string | undefined>>;
