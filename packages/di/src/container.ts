import "reflect-metadata";
import { getInjectableOptions } from "./decorators.js";
import { getDependencyTokens } from "./dependencies.js";
import {
  CircularDependencyError,
  DuplicateProviderError,
  MissingProviderError,
  ProviderNotResolvedError,
} from "./errors.js";
import { unwrapForwardRef, type TokenRef } from "./forward-ref.js";
import {
  isBareClassProvider,
  isExistingProvider,
  isFactoryProvider,
  isValueProvider,
  type Provider,
  type Scope,
} from "./providers.js";
import { tokenName, type Class, type Token } from "./tokens.js";

interface NormalizedClassProvider {
  kind: "class";
  token: Token;
  ctor: Class;
  scope: Scope;
}

interface NormalizedValueProvider {
  kind: "value";
  token: Token;
  value: unknown;
}

interface NormalizedFactoryProvider {
  kind: "factory";
  token: Token;
  factory: (...args: unknown[]) => unknown;
  inject: TokenRef[];
}

interface NormalizedExistingProvider {
  kind: "existing";
  token: Token;
  existing: TokenRef;
}

type NormalizedProvider =
  | NormalizedClassProvider
  | NormalizedValueProvider
  | NormalizedFactoryProvider
  | NormalizedExistingProvider;

function normalizeProvider(provider: Provider): NormalizedProvider {
  if (isBareClassProvider(provider)) {
    return {
      kind: "class",
      token: provider,
      ctor: provider,
      scope: getInjectableOptions(provider)?.scope ?? "singleton",
    };
  }
  if (isValueProvider(provider)) {
    return { kind: "value", token: provider.provide, value: provider.useValue };
  }
  if (isFactoryProvider(provider)) {
    return {
      kind: "factory",
      token: provider.provide,
      factory: provider.useFactory as (...args: unknown[]) => unknown,
      inject: provider.inject ?? [],
    };
  }
  if (isExistingProvider(provider)) {
    return { kind: "existing", token: provider.provide, existing: provider.useExisting };
  }
  return {
    kind: "class",
    token: provider.provide,
    ctor: provider.useClass,
    scope: getInjectableOptions(provider.useClass)?.scope ?? "singleton",
  };
}

/**
 * Resolves a dependency graph from registered providers. Singleton
 * instances (and pending resolutions of them) are memoized so that two
 * sibling branches of the same resolve() call that need the same singleton
 * get exactly one instance, never a race-created duplicate.
 */
export class Container {
  readonly #providers = new Map<Token, NormalizedProvider>();
  readonly #instances = new Map<Token, unknown>();
  readonly #inflight = new Map<Token, Promise<unknown>>();

  register<T>(provider: Provider<T>): void {
    const normalized = normalizeProvider(provider);
    if (this.#providers.has(normalized.token)) {
      throw new DuplicateProviderError(normalized.token);
    }
    this.#providers.set(normalized.token, normalized);
  }

  async resolve<T>(token: Token<T>): Promise<T> {
    return this.#resolveInternal(token, []) as Promise<T>;
  }

  get<T>(token: Token<T>): T {
    if (!this.#instances.has(token)) {
      throw new ProviderNotResolvedError(token);
    }
    return this.#instances.get(token) as T;
  }

  /**
   * Resolved singletons in the order they finished constructing — always
   * dependencies before dependents, since a provider can't finish building
   * until everything it depends on already has. `@blixis-io/core` uses this
   * order to run `OnModuleInit` hooks correctly. Transient instances are
   * never cached, so they never appear here.
   */
  getResolvedEntries(): ReadonlyArray<readonly [Token, unknown]> {
    return [...this.#instances.entries()];
  }

  async resolveAll(): Promise<void> {
    // Safe to run concurrently: #resolveInternal memoizes in-flight
    // singleton resolutions, so shared dependencies are still built once.
    // Waits for every resolution to settle before rejecting with the first failure: providers still being
    // built when one fails would otherwise finish unnoticed, after the caller has already seen the
    // rejection, and could never be cleaned up.
    const results = await Promise.allSettled([...this.#providers.keys()].map((token) => this.resolve(token)));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) {
      throw failed.reason;
    }
  }

  async #resolveInternal(token: Token, chain: readonly Token[]): Promise<unknown> {
    if (this.#instances.has(token)) {
      return this.#instances.get(token);
    }

    if (chain.includes(token)) {
      const cycleStart = chain.indexOf(token);
      throw new CircularDependencyError([...chain.slice(cycleStart), token].map(tokenName));
    }

    const provider = this.#providers.get(token);
    if (!provider) {
      throw new MissingProviderError([...chain, token].map(tokenName));
    }

    const cacheable = provider.kind !== "class" || provider.scope === "singleton";

    if (cacheable) {
      const pending = this.#inflight.get(token);
      if (pending) {
        return pending;
      }
    }

    const nextChain = [...chain, token];
    const instancePromise = this.#instantiate(provider, nextChain);

    if (cacheable) {
      this.#inflight.set(token, instancePromise);
    }

    const instance = await instancePromise;

    if (cacheable) {
      this.#instances.set(token, instance);
      this.#inflight.delete(token);
    }

    return instance;
  }

  async #instantiate(provider: NormalizedProvider, chain: readonly Token[]): Promise<unknown> {
    switch (provider.kind) {
      case "value":
        return provider.value;
      case "existing":
        return this.#resolveInternal(unwrapForwardRef(provider.existing), chain);
      case "factory": {
        const args = await Promise.all(
          provider.inject.map((ref) => this.#resolveInternal(unwrapForwardRef(ref), chain)),
        );
        return provider.factory(...args);
      }
      case "class": {
        const args = await this.#resolveConstructorArgs(provider.ctor, chain);
        return new provider.ctor(...(args as never[]));
      }
      /* v8 ignore start -- @preserve: exhaustiveness guard, unreachable through the public API */
      default: {
        const exhaustive: never = provider;
        throw new Error(`Unreachable: unknown provider kind ${(exhaustive as NormalizedProvider).kind}`);
      }
      /* v8 ignore stop */
    }
  }

  async #resolveConstructorArgs(ctor: Class, chain: readonly Token[]): Promise<unknown[]> {
    const dependencies = getDependencyTokens(ctor);
    return Promise.all(dependencies.map((dep) => this.#resolveDependency(dep.token, chain, dep.optional)));
  }

  async #resolveDependency(token: Token, chain: readonly Token[], optional: boolean): Promise<unknown> {
    if (optional && !this.#providers.has(token) && !this.#instances.has(token)) {
      return undefined;
    }
    return this.#resolveInternal(token, chain);
  }
}
