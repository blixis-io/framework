import { defineConfig, type RolldownOptions } from "rolldown";
import { dts } from "rolldown-plugin-dts";

// Never bundle Node builtins, other @blixis/* packages, or peer/runtime deps
// into a package's own output — each package ships as a thin ESM module
// that imports its dependencies at the consumer's node_modules, exactly
// like the source did. Bundling @blixis/di into @blixis/http, for
// instance, would create a second, disconnected DI container instance.
const EXTERNAL = [/^node:/, /^@blixis\//, "reflect-metadata", "zod", "drizzle-orm", /^drizzle-orm\//, "pg", "jose"];

export function createBuildConfig(): RolldownOptions {
  return defineConfig({
    input: "src/index.ts",
    output: {
      dir: "dist",
      format: "esm",
      sourcemap: true,
    },
    external: EXTERNAL,
    plugins: [
      dts({
        tsconfig: "./tsconfig.build.json",
      }),
    ],
  });
}
