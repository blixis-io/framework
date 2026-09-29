import { tokenName, type Token } from "./tokens.js";

export class DiError extends Error {
  override readonly name: string = "DiError";
}

export class NotInjectableError extends DiError {
  override readonly name = "NotInjectableError";

  constructor(target: { name: string }) {
    super(
      `${target.name} has constructor parameters but is missing @Injectable() — ` +
        "decorator metadata is only emitted for decorated classes.",
    );
  }
}

export class UnresolvableParameterError extends DiError {
  override readonly name = "UnresolvableParameterError";

  constructor(target: { name: string }, parameterIndex: number, typeName: string) {
    super(
      `Parameter #${parameterIndex} of ${target.name} is ${typeName} — ` +
        "add @Inject(token) or import the class as a value.",
    );
  }
}

export class MissingProviderError extends DiError {
  override readonly name = "MissingProviderError";
  readonly chain: readonly string[];

  constructor(chain: readonly string[]) {
    const target = chain.at(-1);
    super(
      chain.length > 1
        ? `No provider for "${target}" (resolution path: ${chain.join(" -> ")})`
        : `No provider for "${target}"`,
    );
    this.chain = chain;
  }
}

export class CircularDependencyError extends DiError {
  override readonly name = "CircularDependencyError";
  readonly chain: readonly string[];

  constructor(chain: readonly string[]) {
    super(`Circular dependency detected: ${chain.join(" -> ")}`);
    this.chain = chain;
  }
}

export class ProviderNotResolvedError extends DiError {
  override readonly name = "ProviderNotResolvedError";

  constructor(token: Token) {
    super(`${tokenName(token)} has not been resolved yet — call resolve() before get().`);
  }
}

export class DuplicateProviderError extends DiError {
  override readonly name = "DuplicateProviderError";

  constructor(token: Token) {
    super(`A provider for ${tokenName(token)} is already registered.`);
  }
}
