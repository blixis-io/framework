// Must load before anything touches Reflect.metadata (container.ts does,
// transitively, via decorators.ts/metadata.ts) — imported first and
// explicitly here so consumers never have to remember it themselves.
import "reflect-metadata";
import { assertSingleInstance } from "./instance.js";

assertSingleInstance("@blixis-io/di", import.meta.url);

export { Container } from "./container.js";
export { assertSingleInstance, DuplicatePackageError, packageVersion } from "./instance.js";
export { getDependencyTokens, type DependencyDescriptor } from "./dependencies.js";
export {
  getInjectableOptions,
  getInjectOverrides,
  getOptionalParams,
  Inject,
  Injectable,
  Optional,
  type InjectableOptions,
  type ResolvedInjectableOptions,
} from "./decorators.js";
export {
  CircularDependencyError,
  DiError,
  DuplicateProviderError,
  MissingProviderError,
  NotInjectableError,
  ProviderNotResolvedError,
  UnresolvableParameterError,
} from "./errors.js";
export { forwardRef, isForwardRef, unwrapForwardRef, type ForwardRef, type TokenRef } from "./forward-ref.js";
export { defineMetadata, getMetadata, getOwnMetadata, type MetadataKey } from "./metadata.js";
export {
  isBareClassProvider,
  isClassProvider,
  isExistingProvider,
  isFactoryProvider,
  isValueProvider,
  providerToken,
  type ClassProvider,
  type ExistingProvider,
  type FactoryProvider,
  type Provider,
  type Scope,
  type ValueProvider,
} from "./providers.js";
export { InjectionToken, tokenName, type AbstractClass, type Class, type Token } from "./tokens.js";
