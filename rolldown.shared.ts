import { defineConfig, type RolldownOptions } from "rolldown";
import { dts } from "rolldown-plugin-dts";

// Never bundle Node builtins, other @blixis-io/* packages, or peer/runtime deps
// into a package's own output — each package ships as a thin ESM module
// that imports its dependencies at the consumer's node_modules, exactly
// like the source did. Bundling @blixis-io/di into @blixis-io/http, for
// instance, would create a second, disconnected DI container instance.
const EXTERNAL = [/^node:/, /^@blixis-io\//, "reflect-metadata", "zod", "drizzle-orm", /^drizzle-orm\//, "pg", "jose"];

/** `input` is one entry, or a name -> path map when a package ships more than one (a library entry plus a bin). */
export function createBuildConfig(input: string | Record<string, string> = "src/index.ts"): RolldownOptions {
  return defineConfig({
    input,
    output: {
      dir: "dist",
      format: "esm",
      sourcemap: true,
      entryFileNames: "[name].js",
    },
    external: EXTERNAL,
    plugins: [
      dts({
        tsconfig: "./tsconfig.build.json",
      }),
    ],
  });
}
