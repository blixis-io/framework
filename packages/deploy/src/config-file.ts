const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A JavaScript literal for plain data, readable enough to be a starting point someone edits: short flat objects stay on one line. */
export function literal(value: unknown, depth = 0): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => literal(item, depth)).join(", ")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    const key = (name: string): string => (IDENTIFIER.test(name) ? name : JSON.stringify(name));
    const flat = entries.every(([, item]) => typeof item !== "object" || item === null);
    if (flat) {
      return entries.length === 0 ? "{}" : `{ ${entries.map(([name, item]) => `${key(name)}: ${literal(item, depth)}`).join(", ")} }`;
    }
    const pad = "  ".repeat(depth + 1);
    return `{\n${entries.map(([name, item]) => `${pad}${key(name)}: ${literal(item, depth + 1)},`).join("\n")}\n${"  ".repeat(depth)}}`;
  }
  return JSON.stringify(value);
}

/** One target as it appears under `deploy.targets`, indented to sit at `depth` levels. */
export function renderTarget(name: string, target: Record<string, unknown>, comments: readonly string[], depth: number): string {
  const pad = "  ".repeat(depth + 1);
  const lines = Object.entries(target).map(([key, value]) => `${pad}${key}: ${literal(value, depth + 1)},`);
  const notes = comments.map((comment) => `${pad}// ${comment}`);
  return `${"  ".repeat(depth)}${name}: {\n${[...lines, ...notes].join("\n")}\n${"  ".repeat(depth)}},`;
}

export function renderConfigFile(name: string, target: Record<string, unknown>, comments: readonly string[]): string {
  return `import { defineConfig } from "@blixis-io/cli";

export default defineConfig({
  deploy: {
    targets: {
${renderTarget(name, target, comments, 3)}
    },
  },
});
`;
}
