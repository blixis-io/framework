import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Writes a fake `@blixis-io/<name>` plugin package into `cwd/node_modules`, whose command echoes what it was given. */
export function installFakePlugin(cwd: string, name: string, body?: string): void {
  const dir = join(cwd, "node_modules", "@blixis-io", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: `@blixis-io/${name}`, version: "0.0.0", type: "module", exports: { ".": { default: "./index.js" } } }),
  );
  writeFileSync(
    join(dir, "index.js"),
    body ??
      `export const blixCommand = {
  name: "${name}",
  description: "fake",
  run: ({ args, cwd, config }) => ({
    exitCode: 0,
    stdout: JSON.stringify({ args, cwd, config: config ? config.config : null }) + "\\n",
    stderr: "",
  }),
};
`,
  );
}
