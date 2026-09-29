export type Class<T = unknown> = new (...args: never[]) => T;

/**
 * An abstract class used purely as an injection token (the Angular-style
 * "provide an interface" pattern: `abstract class Logger {}` + `{ provide:
 * Logger, useClass: ConsoleLogger }`). Kept distinct from {@link Class}
 * because `useClass`/bare-class registration must stay concrete —
 * you can't `new` an abstract class.
 */
export type AbstractClass<T = unknown> = abstract new (...args: never[]) => T;

/**
 * A typed injection token for values that aren't classes (config, interfaces,
 * primitives). Identity-based: two tokens with the same description are
 * still distinct, same as a `Symbol`.
 */
export class InjectionToken<T> {
  /** Carries the type parameter so `Token<T>` inference works at call sites; never read at runtime. */
  declare readonly __type?: T;

  constructor(public readonly description: string) {}

  toString(): string {
    return `InjectionToken(${this.description})`;
  }
}

export type Token<T = unknown> = Class<T> | AbstractClass<T> | InjectionToken<T>;

export function tokenName(token: Token): string {
  return typeof token === "function" ? token.name : token.toString();
}
