import type { TokenRef } from "./forward-ref.js";
import type { Class, Token } from "./tokens.js";

export type Scope = "singleton" | "transient";

export interface ClassProvider<T = unknown> {
  provide: Token<T>;
  useClass: Class<T>;
}

export interface ValueProvider<T = unknown> {
  provide: Token<T>;
  useValue: T;
}

export interface FactoryProvider<T = unknown> {
  provide: Token<T>;
  useFactory: (...args: never[]) => T | Promise<T>;
  inject?: TokenRef[];
}

export interface ExistingProvider<T = unknown> {
  provide: Token<T>;
  useExisting: TokenRef<T>;
}

export type Provider<T = unknown> =
  | Class<T>
  | ClassProvider<T>
  | ValueProvider<T>
  | FactoryProvider<T>
  | ExistingProvider<T>;

export function isClassProvider(provider: object): provider is ClassProvider {
  return "useClass" in provider;
}

export function isValueProvider(provider: object): provider is ValueProvider {
  return "useValue" in provider;
}

export function isFactoryProvider(provider: object): provider is FactoryProvider {
  return "useFactory" in provider;
}

export function isExistingProvider(provider: object): provider is ExistingProvider {
  return "useExisting" in provider;
}

export function isBareClassProvider(provider: Provider): provider is Class {
  return typeof provider === "function";
}

export function providerToken(provider: Provider): Token {
  return isBareClassProvider(provider) ? provider : provider.provide;
}
