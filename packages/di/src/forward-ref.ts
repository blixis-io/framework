import type { Token } from "./tokens.js";

const FORWARD_REF = Symbol("ForwardRef");

export interface ForwardRef<T = unknown> {
  (): Token<T>;
  readonly [FORWARD_REF]: true;
}

/**
 * Defers resolving a token reference until it's actually needed, so two
 * classes in different (or the same) modules can depend on each other
 * without one of them being `undefined` at class-evaluation time.
 */
export function forwardRef<T>(resolver: () => Token<T>): ForwardRef<T> {
  return Object.assign(resolver, { [FORWARD_REF]: true as const });
}

export function isForwardRef(value: unknown): value is ForwardRef {
  return typeof value === "function" && FORWARD_REF in value;
}

export type TokenRef<T = unknown> = Token<T> | ForwardRef<T>;

export function unwrapForwardRef<T>(ref: TokenRef<T>): Token<T> {
  return isForwardRef(ref) ? ref() : ref;
}
