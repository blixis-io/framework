import type { ZodType } from "zod";
import type { ParamSource } from "./decorators/params.js";
import { BadRequestException } from "./exceptions.js";

export interface ParamResolutionContext {
  request: Request;
  routeParams: Readonly<Record<string, string>>;
  /** Reads and JSON-parses the body, memoized per-request by the caller. Rejects with an HttpException (400/413/415) on failure. */
  getBody: () => Promise<unknown>;
}

async function parseWithSchema(schema: ZodType, value: unknown): Promise<unknown> {
  const result = await schema.safeParseAsync(value);
  if (!result.success) {
    throw new BadRequestException("Validation failed", { issues: result.error.issues });
  }
  return result.data;
}

async function resolveOne(source: ParamSource, context: ParamResolutionContext): Promise<unknown> {
  switch (source.kind) {
    case "req":
      return context.request;
    case "headers":
      return source.name ? context.request.headers.get(source.name) : Object.fromEntries(context.request.headers);
    case "param": {
      const raw = context.routeParams[source.name];
      return source.schema ? parseWithSchema(source.schema, raw) : raw;
    }
    case "query": {
      const raw = Object.fromEntries(new URL(context.request.url).searchParams);
      return source.schema ? parseWithSchema(source.schema, raw) : raw;
    }
    case "body": {
      const raw = await context.getBody();
      return source.schema ? parseWithSchema(source.schema, raw) : raw;
    }
    /* v8 ignore start -- @preserve: exhaustiveness guard, unreachable through the public API */
    default: {
      const exhaustive: never = source;
      throw new Error(`Unreachable: unknown param source kind ${(exhaustive as ParamSource).kind}`);
    }
    /* v8 ignore stop */
  }
}

/** Builds the positional argument list for a route handler from its `@Body`/`@Query`/`@Param`/`@Headers`/`@Req` metadata. */
export async function resolveHandlerArgs(
  sources: ReadonlyMap<number, ParamSource>,
  context: ParamResolutionContext,
): Promise<unknown[]> {
  if (sources.size === 0) {
    return [];
  }

  const args: unknown[] = Array.from<unknown>({ length: Math.max(...sources.keys()) + 1 });

  await Promise.all(
    [...sources.entries()].map(async ([index, source]) => {
      args[index] = await resolveOne(source, context);
    }),
  );

  return args;
}
