import {
  Container,
  getDependencyTokens,
  isBareClassProvider,
  isClassProvider,
  isExistingProvider,
  isFactoryProvider,
  providerToken,
  tokenName,
  unwrapForwardRef,
  type Class,
  type DependencyDescriptor,
  type Provider,
  type Token,
} from "@blixis-io/di";
import { NotAModuleError, ProviderNotVisibleError } from "./errors.js";
import { hasOnApplicationShutdown, hasOnModuleInit } from "./lifecycle.js";
import { getModuleMetadata, isDynamicModule, moduleClassOf, type ModuleRef } from "./module.js";

interface CollectedModule {
  readonly moduleClass: Class;
  readonly providers: readonly Provider[];
  readonly controllers: readonly Class[];
  readonly exports: ReadonlySet<Token>;
  readonly global: boolean;
  readonly importedClasses: readonly Class[];
}

/** Walks the import graph once, deduping by module class (diamond imports visited only once). Doesn't touch the container — just gathers what each module declares. */
function collectModules(root: ModuleRef): ReadonlyMap<Class, CollectedModule> {
  const modules = new Map<Class, CollectedModule>();
  visit(root, modules);
  return modules;
}

function visit(ref: ModuleRef, modules: Map<Class, CollectedModule>): void {
  const moduleClass = moduleClassOf(ref);
  if (modules.has(moduleClass)) {
    return;
  }

  const staticMetadata = getModuleMetadata(moduleClass);
  if (!staticMetadata) {
    throw new NotAModuleError(moduleClass);
  }

  const dynamicMetadata = isDynamicModule(ref) ? ref : undefined;
  const imports = [...(staticMetadata.imports ?? []), ...(dynamicMetadata?.imports ?? [])];

  // Set before recursing so a module reached twice (diamond, or a cycle) is
  // only ever collected once.
  modules.set(moduleClass, {
    moduleClass,
    providers: [...(staticMetadata.providers ?? []), ...(dynamicMetadata?.providers ?? [])],
    controllers: [...(staticMetadata.controllers ?? []), ...(dynamicMetadata?.controllers ?? [])],
    exports: new Set([...(staticMetadata.exports ?? []), ...(dynamicMetadata?.exports ?? [])]),
    global: staticMetadata.global === true || dynamicMetadata?.global === true,
    importedClasses: imports.map(moduleClassOf),
  });

  for (const importRef of imports) {
    visit(importRef, modules);
  }
}

/** What a provider itself needs, regardless of shape — a class's constructor params, a factory's `inject` list, or a `useExisting` alias target. `useValue` needs nothing. */
function requiredTokensOf(provider: Provider): readonly DependencyDescriptor[] {
  if (isBareClassProvider(provider)) {
    return getDependencyTokens(provider);
  }
  if (isClassProvider(provider)) {
    return getDependencyTokens(provider.useClass);
  }
  if (isFactoryProvider(provider)) {
    return (provider.inject ?? []).map((ref, index) => ({ index, token: unwrapForwardRef(ref), optional: false }));
  }
  if (isExistingProvider(provider)) {
    return [{ index: 0, token: unwrapForwardRef(provider.useExisting), optional: false }];
  }
  return [];
}

function providerDisplayName(provider: Provider): string {
  if (isBareClassProvider(provider)) {
    return provider.name;
  }
  if (isClassProvider(provider)) {
    return provider.useClass.name;
  }
  return tokenName(providerToken(provider));
}

function isVisible(
  token: Token,
  ownTokens: ReadonlySet<Token>,
  importedClasses: readonly Class[],
  modules: ReadonlyMap<Class, CollectedModule>,
  globalExports: ReadonlySet<Token>,
): boolean {
  if (ownTokens.has(token) || globalExports.has(token)) {
    return true;
  }
  return importedClasses.some((importedClass) => {
    // `collectModules` visits every import, so `importedClass` is always
    // present — the `?? false` is unreachable, not a real "unknown import".
    /* v8 ignore next -- @preserve */
    return modules.get(importedClass)?.exports.has(token) ?? false;
  });
}

/**
 * Registers every module's providers/controllers into `container`, enforcing
 * `exports`: a provider may only depend on a token it owns itself, a token
 * exported by a module it directly imports, or a token exported by any
 * `global` module. A dependency that exists nowhere in the whole graph is
 * left alone here — that's `MissingProviderError`/`@Optional()`'s job at
 * resolution time, not an encapsulation concern.
 */
function buildApplicationGraph(
  modules: ReadonlyMap<Class, CollectedModule>,
  container: Container,
  overridesByToken: ReadonlyMap<Token, Provider>,
): Class[] {
  const tokenOwner = new Map<Token, Class>();
  const ownTokensByModule = new Map<Class, Set<Token>>();
  const globalExports = new Set<Token>();

  for (const module of modules.values()) {
    const ownTokens = new Set<Token>();
    for (const provider of module.providers) {
      const token = providerToken(provider);
      tokenOwner.set(token, module.moduleClass);
      ownTokens.add(token);
    }
    ownTokensByModule.set(module.moduleClass, ownTokens);

    if (module.global) {
      for (const token of module.exports) {
        globalExports.add(token);
      }
    }
  }

  function assertVisible(consumerName: string, module: CollectedModule, required: readonly DependencyDescriptor[]): void {
    // Every module in `modules` got an entry above, and assertVisible is
    // only ever called with a module from that same collection — the
    // fallback is unreachable.
    /* v8 ignore next -- @preserve */
    const ownTokens = ownTokensByModule.get(module.moduleClass) ?? new Set<Token>();
    for (const { token } of required) {
      const owner = tokenOwner.get(token);
      if (owner && !isVisible(token, ownTokens, module.importedClasses, modules, globalExports)) {
        throw new ProviderNotVisibleError(consumerName, tokenName(token), owner.name);
      }
    }
  }

  const controllers: Class[] = [];

  for (const module of modules.values()) {
    for (const provider of module.providers) {
      const effective = overridesByToken.get(providerToken(provider)) ?? provider;
      assertVisible(providerDisplayName(effective), module, requiredTokensOf(effective));
      container.register(effective);
    }

    for (const controller of module.controllers) {
      assertVisible(controller.name, module, getDependencyTokens(controller));
      container.register(controller);
      controllers.push(controller);
    }
  }

  return controllers;
}

/**
 * A running application: one flattened `Container` built from a module
 * graph, with every provider eagerly resolved and `OnModuleInit` hooks run
 * in dependency order.
 */
export class Application {
  readonly controllers: readonly Class[];
  readonly #container: Container;
  #closed = false;

  private constructor(container: Container, controllers: Class[]) {
    this.#container = container;
    this.controllers = controllers;
  }

  static async create(rootModule: ModuleRef, options: CreateApplicationOptions = {}): Promise<Application> {
    const modules = collectModules(rootModule);
    const overridesByToken = new Map<Token, Provider>(
      (options.overrides ?? []).map((override) => [providerToken(override), override]),
    );

    const container = new Container();
    const controllers = buildApplicationGraph(modules, container, overridesByToken);

    await container.resolveAll();

    // Sequential and order-dependent: dependencies must finish initializing
    // before their dependents, so this can't become a Promise.all().
    for (const [, instance] of container.getResolvedEntries()) {
      if (hasOnModuleInit(instance)) {
        await instance.onModuleInit();
      }
    }

    return new Application(container, controllers);
  }

  get<T>(token: Token<T>): T {
    return this.#container.get(token);
  }

  async close(signal?: string): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;

    // Same ordering constraint as create(), reversed: dependents shut down
    // before what they depend on.
    const entries = this.#container.getResolvedEntries().toReversed();
    for (const [, instance] of entries) {
      if (hasOnApplicationShutdown(instance)) {
        await instance.onApplicationShutdown(signal);
      }
    }
  }
}

export interface CreateApplicationOptions {
  /** Providers to swap in for the module graph's own, matched by token — the seam `@blixis-io/testing` uses for mocking. */
  overrides?: Provider[] | undefined;
}

export async function createApplication(
  rootModule: ModuleRef,
  options: CreateApplicationOptions = {},
): Promise<Application> {
  return Application.create(rootModule, options);
}
