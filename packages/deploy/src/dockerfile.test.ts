import { describe, expect, it } from "vitest";
import { DOCKERIGNORE, DockerfileError, renderDockerfile } from "./dockerfile.js";

describe("renderDockerfile", () => {
  it("renders a pnpm multi-stage build", () => {
    const file = renderDockerfile({ packageManager: "pnpm", entry: "dist/main.js" });

    expect(file).toContain("RUN corepack enable");
    expect(file).toContain("COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./");
    expect(file).toContain("RUN pnpm install --frozen-lockfile");
    expect(file).toContain("RUN pnpm run build && pnpm prune --prod");
    expect(file).toContain('CMD ["node", "dist/main.js"]');
  });

  it("renders an npm multi-stage build", () => {
    const file = renderDockerfile({ packageManager: "npm", entry: "dist/main.js" });

    expect(file).toContain("COPY package.json package-lock.json ./");
    expect(file).toContain("RUN npm ci");
    expect(file).toContain("RUN npm run build && npm prune --omit=dev");
    expect(file).not.toContain("corepack");
  });

  it("ships only production dependencies and dist, and doesn't run as root", () => {
    const file = renderDockerfile({ packageManager: "pnpm", entry: "dist/main.js" });

    expect(file).toContain("COPY --from=build /app/node_modules ./node_modules");
    expect(file).toContain("COPY --from=build /app/dist ./dist");
    expect(file).toContain("USER node");
  });

  it("uses the given entry", () => {
    expect(renderDockerfile({ packageManager: "npm", entry: "dist/server.js" })).toContain('CMD ["node", "dist/server.js"]');
  });

  it.each(["yarn", "bun"] as const)("refuses %s with a pointer to the dockerfile option", (packageManager) => {
    expect(() => renderDockerfile({ packageManager, entry: "dist/main.js" })).toThrow(DockerfileError);
    expect(() => renderDockerfile({ packageManager, entry: "dist/main.js" })).toThrow('set "dockerfile"');
  });
});

describe("DOCKERIGNORE", () => {
  it("keeps secrets and build output out of the image context", () => {
    expect(DOCKERIGNORE.split("\n")).toEqual(expect.arrayContaining(["node_modules", "dist", ".git", ".env", ".env.*", "!.env.example"]));
  });
});
