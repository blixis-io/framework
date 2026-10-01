#!/usr/bin/env node
import { runCli } from "./index.js";

// Kept separate from index.ts: that one is also the importable library entry, and importing a module
// that runs `await runCli(...)` at the top level deadlocks any plugin or config that imports it.
/* v8 ignore start -- @preserve: process wiring, exercised by index.test.ts spawning the real built binary */
const result = await runCli(process.argv.slice(2), process.cwd());
if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}
process.exitCode = result.exitCode;
/* v8 ignore stop */
