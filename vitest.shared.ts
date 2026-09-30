import { fileURLToPath } from "node:url";
import { defineProject, mergeConfig, type UserProjectConfigExport } from "vitest/config";

// Vite 8 transforms TS via Oxc by default. Oxc must be told explicitly to
// emit legacy decorators + design-time metadata, or `@blixis/di` sees
// `undefined` paramtypes under test even though `tsc` emits them correctly.
// Keep these two flags mirroring tsconfig.base.json's
// experimentalDecorators/emitDecoratorMetadata.
const oxcDecoratorConfig = {
  oxc: {
    decorator: {
      legacy: true,
      emitDecoratorMetadata: true,
    },
  },
} as const;

const blixisAlias = (pkg: string) => ({
  find: new RegExp(`^@blixis/${pkg}$`),
  replacement: fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url)),
});

export function createProjectConfig(name: string, config: UserProjectConfigExport = {}) {
  return mergeConfig(
    defineProject({
      ...oxcDecoratorConfig,
      resolve: {
        alias: [
          blixisAlias("di"),
          blixisAlias("core"),
          blixisAlias("http"),
          blixisAlias("testing"),
          blixisAlias("logging"),
          blixisAlias("config"),
          blixisAlias("db"),
        ],
      },
      test: {
        name,
        globals: false,
        environment: "node",
        include: ["src/**/*.test.ts"],
      },
    }),
    config,
  );
}
