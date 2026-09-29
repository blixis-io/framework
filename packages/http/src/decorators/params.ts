import { defineMetadata, getMetadata } from "@blixis/di";
import type { ZodType } from "zod";

export type ParamSource =
  | { kind: "body"; schema?: ZodType | undefined }
  | { kind: "query"; schema?: ZodType | undefined }
  | { kind: "param"; name: string; schema?: ZodType | undefined }
  | { kind: "headers"; name?: string | undefined }
  | { kind: "req" };

const PARAMS = Symbol("blixis:params");

function paramDecorator(source: ParamSource): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    if (propertyKey === undefined) {
      throw new Error("@Body/@Query/@Param/@Headers/@Req can only decorate route handler method parameters, not constructor parameters.");
    }
    const sources =
      getMetadata<Map<number, ParamSource>>(PARAMS, target, propertyKey) ?? new Map<number, ParamSource>();
    sources.set(parameterIndex, source);
    defineMetadata(PARAMS, sources, target, propertyKey);
  };
}

/** Parses the JSON request body, validating it with `schema` when given. */
export function Body(schema?: ZodType): ParameterDecorator {
  return paramDecorator({ kind: "body", schema });
}

/** The parsed query string as an object, validated with `schema` when given. */
export function Query(schema?: ZodType): ParameterDecorator {
  return paramDecorator({ kind: "query", schema });
}

/** One route param by name, validated with `schema` when given (otherwise the raw string). */
export function Param(name: string, schema?: ZodType): ParameterDecorator {
  return paramDecorator({ kind: "param", name, schema });
}

/** One request header by name, or all headers as an object when `name` is omitted. */
export function Headers(name?: string): ParameterDecorator {
  return paramDecorator({ kind: "headers", name });
}

/** The raw Web-standard `Request`. */
export function Req(): ParameterDecorator {
  return paramDecorator({ kind: "req" });
}

export function getParamSources(target: object, propertyKey: string | symbol): Map<number, ParamSource> {
  return getMetadata(PARAMS, target, propertyKey) ?? new Map();
}
