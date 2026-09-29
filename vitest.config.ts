import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "examples/*"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts"],
      thresholds: {
        lines: 90,
        branches: 90,
      },
    },
  },
});
