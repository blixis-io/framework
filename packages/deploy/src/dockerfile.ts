import type { PackageManager } from "@blixis-io/cli";

export class DockerfileError extends Error {
  override readonly name = "DockerfileError";
}

export interface DockerfileOptions {
  packageManager: PackageManager;
  /** The compiled entry the container runs. */
  entry: string;
}

/** A multi-stage image: build everything, then ship only production dependencies and `dist/`. */
export function renderDockerfile({ packageManager, entry }: DockerfileOptions): string {
  if (packageManager !== "pnpm" && packageManager !== "npm") {
    throw new DockerfileError(
      `Dockerfile generation supports pnpm and npm, and this project uses ${packageManager}. Write your own Dockerfile and set "dockerfile" on the target.`,
    );
  }

  const pnpm = packageManager === "pnpm";
  const install = pnpm
    ? `RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile`
    : `WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci`;
  const build = pnpm ? "RUN pnpm run build && pnpm prune --prod" : "RUN npm run build && npm prune --omit=dev";

  return `FROM node:24-alpine AS build
${install}
COPY tsconfig*.json ./
COPY src ./src
${build}

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000
CMD ["node", "${entry}"]
`;
}

export const DOCKERIGNORE = "node_modules\ndist\n.git\n.env\n.env.*\n!.env.example\n";
