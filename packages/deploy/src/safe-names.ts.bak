/**
 * The names `blix deploy` copies into files it generates: a Dockerfile's `CMD`, and the workflow, `.gitlab-ci.yml` and
 * `bitbucket-pipelines.yml` that run with your deploy secrets. Each is checked against what that kind of name can be, so
 * a newline, a quote, a `;` or a `$(...)` in a flag or in `blix.config.ts` can't become a second instruction, an extra
 * workflow step or a shell command in a file that holds credentials.
 */

/** A target's name goes into `run: blix deploy <name>`, a shell command line. */
export const TARGET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * An environment variable name: it becomes a YAML key and `${{ secrets.NAME }}`. Not one of the words YAML reads as a
 * boolean or null (`true`, `no`, `on`, `null`, ...): as a key those would stop being the name you wrote.
 */
export const ENV_NAME = /^(?![Yy]$|[Nn]$|(?:true|false|yes|no|on|off|null)$)[A-Za-z_][A-Za-z0-9_]*$/i;

/** A branch (or a pattern such as `release/*`): it goes into `branches: [<name>]` and a shell comparison. */
export const BRANCH_NAME = /^[A-Za-z0-9_][A-Za-z0-9._/*-]*$/;

export class UnsafeNameError extends Error {
  override readonly name = "UnsafeNameError";
}

/** Throws unless `value` is what `kind` can be. The message shows the value as JSON, so an invisible character shows up. */
export function assertSafeName(kind: string, value: string, pattern: RegExp, allowed: string): void {
  if (!pattern.test(value)) {
    throw new UnsafeNameError(`${kind} ${JSON.stringify(value)} can't go into a generated file: ${allowed}.`);
  }
}

export const TARGET_NAME_RULE = "use letters, digits, '.', '_' and '-', starting with a letter or digit";
export const ENV_NAME_RULE = "an environment variable name is letters, digits and '_', not starting with a digit, and not a word YAML reads as a boolean or null (true, false, yes, no, on, off, null, y, n)";
export const BRANCH_NAME_RULE = "a branch starts with a letter, digit or '_' and is letters, digits and any of '.', '_', '/', '-', '*', with no spaces or quotes";
