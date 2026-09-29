import type { TokenRef } from "./forward-ref.js";
import { defineMetadata, getMetadata } from "./metadata.js";
import type { Scope } from "./providers.js";

const INJECTABLE_OPTIONS = Symbol("blixis:injectable-options");
const INJECT_OVERRIDES = Symbol("blixis:inject-overrides");
const OPTIONAL_PARAMS = Symbol("blixis:optional-params");

export interface InjectableOptions {
  scope?: Scope;
}

export interface ResolvedInjectableOptions {
  scope: Scope;
}

/**
 * Marks a class as constructible by the container. Required even for
 * zero-dependency classes with default options: TypeScript only emits
 * `design:paramtypes` for classes that carry at least one class decorator,
 * so an undecorated class with constructor params has no usable metadata
 * at all (see {@link NotInjectableError}).
 */
export function Injectable(options: InjectableOptions = {}): ClassDecorator {
  return (target) => {
    const resolved: ResolvedInjectableOptions = { scope: options.scope ?? "singleton" };
    defineMetadata(INJECTABLE_OPTIONS, resolved, target);
  };
}

export function getInjectableOptions(target: object): ResolvedInjectableOptions | undefined {
  return getMetadata(INJECTABLE_OPTIONS, target);
}

/** Overrides the reflected constructor parameter type for a specific position. */
export function Inject(token: TokenRef): ParameterDecorator {
  return (target, _propertyKey, parameterIndex) => {
    const overrides = getMetadata<Map<number, TokenRef>>(INJECT_OVERRIDES, target) ?? new Map<number, TokenRef>();
    overrides.set(parameterIndex, token);
    defineMetadata(INJECT_OVERRIDES, overrides, target);
  };
}

export function getInjectOverrides(target: object): Map<number, TokenRef> | undefined {
  return getMetadata(INJECT_OVERRIDES, target);
}

/** Marks a constructor parameter as allowed to resolve to `undefined` when no provider is registered. */
export function Optional(): ParameterDecorator {
  return (target, _propertyKey, parameterIndex) => {
    const optional = getMetadata<Set<number>>(OPTIONAL_PARAMS, target) ?? new Set<number>();
    optional.add(parameterIndex);
    defineMetadata(OPTIONAL_PARAMS, optional, target);
  };
}

export function getOptionalParams(target: object): Set<number> | undefined {
  return getMetadata(OPTIONAL_PARAMS, target);
}
