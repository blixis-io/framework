import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "examples/*"],
    coverage: {
      provider: "v8",
      // lcov is what Codecov reads (coverage/lcov.info); text and html are for reading locally.
      reporter: ["text", "html", "lcov"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts", "**/test-helpers.ts", "**/test-fixtures/**"],
      thresholds: {
        lines: 90,
        branches: 90,
      },
    },
  },
});
