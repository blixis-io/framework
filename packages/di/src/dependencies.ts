import { getInjectOverrides, getOptionalParams } from "./decorators.js";
import { NotInjectableError, UnresolvableParameterError } from "./errors.js";
import { unwrapForwardRef } from "./forward-ref.js";
import { DESIGN_PARAM_TYPES, getMetadata } from "./metadata.js";
import type { Class, Token } from "./tokens.js";

export interface DependencyDescriptor {
  readonly index: number;
  readonly token: Token;
  readonly optional: boolean;
}

/**
 * Computes what a class's constructor parameters resolve to, without
 * instantiating anything — the same reflection `Container` uses internally
 * to actually build instances, exposed so other packages (module
 * encapsulation validation, tooling) can introspect a dependency graph.
 * Throws the same `NotInjectableError`/`UnresolvableParameterError` a
 * real resolution would.
 */
export function getDependencyTokens(ctor: Class): DependencyDescriptor[] {
  const paramTypes = getMetadata<unknown[]>(DESIGN_PARAM_TYPES, ctor);

  if (paramTypes === undefined) {
    if (ctor.length > 0) {
      throw new NotInjectableError(ctor);
    }
    return [];
  }

  const overrides = getInjectOverrides(ctor);
  const optionalParams = getOptionalParams(ctor);

  return paramTypes.map((paramType, index) => {
    const optional = optionalParams?.has(index) ?? false;
    const overrideRef = overrides?.get(index);

    if (overrideRef !== undefined) {
      return { index, token: unwrapForwardRef(overrideRef), optional };
    }

    const rawToken = paramType as Token | undefined;
    if (rawToken === undefined || (rawToken as unknown) === Object) {
      throw new UnresolvableParameterError(ctor, index, rawToken === undefined ? "undefined" : "Object");
    }

    return { index, token: rawToken, optional };
  });
}
