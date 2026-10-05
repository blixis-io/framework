/** Every file of the generated app, keyed by path relative to the project root. */
export function templateFiles(packageName: string, packageManagerPin?: string): Record<string, string> {
  return {
    "package.json": `${JSON.stringify(
      {
        name: packageName,
        version: "0.0.0",
        private: true,
        type: "module",
        // Pins the package manager (corepack honours it), so a Docker image or CI job installs with the same
        // major version the project was created with instead of whatever is newest.
        ...(packageManagerPin ? { packageManager: packageManagerPin } : {}),
        engines: { node: ">=24" },
        scripts: {
          // Decorators need tsc (esbuild/tsx drop the metadata), so dev is "compile once, then
          // recompile on change while node restarts on the new output".
          dev: 'tsc -p tsconfig.json && concurrently -k -n tsc,app "tsc -p tsconfig.json --watch --preserveWatchOutput" "node --watch dist/main.js"',
          build: "tsc -p tsconfig.json",
          start: "node dist/main.js",
          typecheck: "tsc --noEmit -p tsconfig.json",
        },
      },
      null,
      2,
    )}\n`,

    "tsconfig.json": `${JSON.stringify(
      {
        compilerOptions: {
          target: "es2023",
          lib: ["es2023"],
          types: ["node"],
          module: "nodenext",
          moduleResolution: "nodenext",
          strict: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          useDefineForClassFields: false,
          esModuleInterop: true,
          skipLibCheck: true,
          outDir: "dist",
          rootDir: "src",
        },
        include: ["src"],
      },
      null,
      2,
    )}\n`,

    ".gitignore": "node_modules\ndist\n",

    "README.md": `# ${packageName}

A [Blixis](https://blixis-io.github.io/framework/) app.

\`\`\`bash
npm run dev      # rebuilds and restarts on every change
# or: npm run build && npm start
curl http://localhost:3000/hello/world
\`\`\`

Decorators need \`tsc\` (not tsx/esbuild) — see the
[installation notes](https://blixis-io.github.io/framework/start-here/installation/).
`,

    "src/hello.service.ts": `import { Injectable } from "@blixis-io/di";

@Injectable()
export class HelloService {
  greet(name: string): string {
    return \`Hello, \${name}!\`;
  }
}
`,

    "src/hello.controller.ts": `import { Controller, Get, Param } from "@blixis-io/http";
import { HelloService } from "./hello.service.js";

@Controller("hello")
export class HelloController {
  constructor(private readonly hello: HelloService) {}

  @Get(":name")
  greet(@Param("name") name: string) {
    return { message: this.hello.greet(name) };
  }
}
`,

    "src/app.module.ts": `import { Module } from "@blixis-io/core";
import { HelloController } from "./hello.controller.js";
import { HelloService } from "./hello.service.js";

@Module({
  providers: [HelloService],
  controllers: [HelloController],
})
export class AppModule {}
`,

    "src/main.ts": `import { createHttpApplication } from "@blixis-io/http";
import { AppModule } from "./app.module.js";

const app = await createHttpApplication(AppModule);
const port = Number(process.env["PORT"] ?? 3000);
await app.listen(port);

console.log(\`Listening on http://localhost:\${port}\`);

process.on("SIGTERM", () => {
  void app.close("SIGTERM").then(() => process.exit(0));
});
`,
  };
}

export const RUNTIME_DEPENDENCIES = ["@blixis-io/core", "@blixis-io/di", "@blixis-io/http", "zod"] as const;
/** Added only with --deploy: the CLI and its deploy plugin. */
export const DEPLOY_DEPENDENCIES = ["@blixis-io/cli", "@blixis-io/deploy"] as const;
export const DEV_DEPENDENCIES = ["typescript", "@types/node", "concurrently"] as const;
