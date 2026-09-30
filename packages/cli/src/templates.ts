import { toKebabCase, toPascalCase } from "./names.js";

export const GENERATOR_TYPES = ["controller", "service", "module", "guard", "interceptor"] as const;
export type GeneratorType = (typeof GENERATOR_TYPES)[number];

const ALIASES: Record<string, GeneratorType> = {
  c: "controller",
  s: "service",
  m: "module",
  g: "guard",
  i: "interceptor",
};

function isGeneratorType(input: string): input is GeneratorType {
  return (GENERATOR_TYPES as readonly string[]).includes(input);
}

/** Resolves a type argument, accepting either the full name or its one-letter alias. */
export function resolveGeneratorType(input: string): GeneratorType | undefined {
  if (isGeneratorType(input)) {
    return input;
  }
  return ALIASES[input];
}

function renderController(pascal: string, kebab: string): string {
  return `import { Controller, Get } from "@blixis-io/http";

@Controller("${kebab}")
export class ${pascal}Controller {
  @Get()
  list() {
    return [];
  }
}
`;
}

function renderService(pascal: string): string {
  return `import { Injectable } from "@blixis-io/di";

@Injectable()
export class ${pascal}Service {}
`;
}

function renderModule(pascal: string): string {
  return `import { Module } from "@blixis-io/core";

@Module({})
export class ${pascal}Module {}
`;
}

function renderGuard(pascal: string): string {
  return `import { Injectable } from "@blixis-io/di";
import type { CanActivate, ExecutionContext } from "@blixis-io/http";

@Injectable()
export class ${pascal}Guard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return true;
  }
}
`;
}

function renderInterceptor(pascal: string): string {
  return `import { Injectable } from "@blixis-io/di";
import type { ExecutionContext, Interceptor } from "@blixis-io/http";

@Injectable()
export class ${pascal}Interceptor implements Interceptor {
  async intercept(context: ExecutionContext, next: () => Promise<Response>): Promise<Response> {
    return next();
  }
}
`;
}

/** Renders one generator type's template for `name` (any casing accepted). */
export function renderTemplate(type: GeneratorType, name: string): string {
  const pascal = toPascalCase(name);
  const kebab = toKebabCase(name);

  switch (type) {
    case "controller":
      return renderController(pascal, kebab);
    case "service":
      return renderService(pascal);
    case "module":
      return renderModule(pascal);
    case "guard":
      return renderGuard(pascal);
    case "interceptor":
      return renderInterceptor(pascal);
    /* v8 ignore start -- @preserve: exhaustiveness guard, unreachable through the public API */
    default: {
      const exhaustive: never = type;
      throw new Error(`Unreachable: unknown generator type ${exhaustive as string}`);
    }
    /* v8 ignore stop */
  }
}
