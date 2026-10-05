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
import { hasOnApplicationBootstrap, hasOnApplicationShutdown, hasOnModuleInit } from "./lifecycle.js";
import { getModuleMetadata, isDynamicModule, moduleClassOf, type ModuleRef } from "./module.js";

interface CollectedModule {
  readonly moduleClass: Class;
  /** What this registration itself registers: its dynamic providers, plus the class's static ones if it is the first registration of the class. */
  readonly providers: readonly Provider[];
  readonly controllers: readonly Class[];
  /** Tokens this registration may depend on without importing anything: its own plus the class's static providers. */
  readonly ownTokens: ReadonlySet<Token>;
  readonly exports: ReadonlySet<Token>;
  readonly global: boolean;
  readonly imports: readonly ModuleRef[];
}

interface ModuleGraph {
  readonly modules: ReadonlyMap<ModuleRef, CollectedModule>;
  /** The entry an import resolves to: a dynamic registration is its own entry; a plain class is the first registration of that class. */
  readonly resolve: (ref: ModuleRef) => CollectedModule | undefined;
}

/**
 * Walks the import graph once. Each *dynamic registration* is its own entry (keyed by the object
 * `forRoot()` returned), so `DatabaseModule.forRoot(a)` and `DatabaseModule.forRoot(b)` coexist —
 * their provider tokens must differ, or the container reports `DuplicateProviderError`. A plain
 * class is one entry. The class's static `@Module()` providers and controllers are registered once,
 * by the first registration of that class; every registration still sees them as its own.
 * Doesn't touch the container — just gathers what each module declares.
 */
function collectModules(root: ModuleRef): ModuleGraph {
  const modules = new Map<ModuleRef, CollectedModule>();
  const firstRegistration = new Map<Class, ModuleRef>();
  visit(root, modules, firstRegistration);

  return {
    modules,
    resolve(ref) {
      return modules.get(isDynamicModule(ref) ? ref : (firstRegistration.get(ref) ?? ref));
    },
  };
}

function visit(ref: ModuleRef, modules: Map<ModuleRef, CollectedModule>, firstRegistration: Map<Class, ModuleRef>): void {
  const moduleClass = moduleClassOf(ref);
  const claimed = firstRegistration.has(moduleClass);

  // A plain class already registered (by itself or by a dynamic registration) adds nothing new.
  if (modules.has(ref) || (claimed && !isDynamicModule(ref))) {
    return;
  }

  const staticMetadata = getModuleMetadata(moduleClass);
  if (!staticMetadata) {
    throw new NotAModuleError(moduleClass);
  }

  const dynamicMetadata = isDynamicModule(ref) ? ref : undefined;
  const dynamicProviders = dynamicMetadata?.providers ?? [];
  const staticProviders = staticMetadata.providers ?? [];
  const imports = [...(staticMetadata.imports ?? []), ...(dynamicMetadata?.imports ?? [])];

  if (!claimed) {
    firstRegistration.set(moduleClass, ref);
  }

  // Set before recursing so a module reached twice (diamond, or a cycle) is
  // only ever collected once.
  modules.set(ref, {
    moduleClass,
    providers: claimed ? dynamicProviders : [...staticProviders, ...dynamicProviders],
    controllers: claimed ? (dynamicMetadata?.controllers ?? []) : [...(staticMetadata.controllers ?? []), ...(dynamicMetadata?.controllers ?? [])],
    ownTokens: new Set([...staticProviders, ...dynamicProviders].map(providerToken)),
    exports: new Set([...(staticMetadata.exports ?? []), ...(dynamicMetadata?.exports ?? [])]),
    global: staticMetadata.global === true || dynamicMetadata?.global === true,
    imports,
  });

  for (const importRef of imports) {
    visit(importRef, modules, firstRegistration);
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

function isVisible(token: Token, module: CollectedModule, graph: ModuleGraph, globalExports: ReadonlySet<Token>): boolean {
  if (module.ownTokens.has(token) || globalExports.has(token)) {
    return true;
  }
  return module.imports.some((importRef) => {
    // `collectModules` visits every import, so it always resolves — the
    // `?? false` is unreachable, not a real "unknown import".
    /* v8 ignore next -- @preserve */
    return graph.resolve(importRef)?.exports.has(token) ?? false;
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
  graph: ModuleGraph,
  container: Container,
  overridesByToken: ReadonlyMap<Token, Provider>,
): Class[] {
  const tokenOwner = new Map<Token, Class>();
  const globalExports = new Set<Token>();

  for (const module of graph.modules.values()) {
    for (const provider of module.providers) {
      tokenOwner.set(providerToken(provider), module.moduleClass);
    }
    if (module.global) {
      for (const token of module.exports) {
        globalExports.add(token);
      }
    }
  }

  function assertVisible(consumerName: string, module: CollectedModule, required: readonly DependencyDescriptor[]): void {
    for (const { token } of required) {
      const owner = tokenOwner.get(token);
      if (owner && !isVisible(token, module, graph, globalExports)) {
        throw new ProviderNotVisibleError(consumerName, tokenName(token), owner.name);
      }
    }
  }

  const controllers: Class[] = [];

  for (const module of graph.modules.values()) {
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
    const graph = collectModules(rootModule);
    const overridesByToken = new Map<Token, Provider>(
      (options.overrides ?? []).map((override) => [providerToken(override), override]),
    );

    const container = new Container();
    const controllers = buildApplicationGraph(graph, container, overridesByToken);

    try {
      await container.resolveAll();

      // Sequential and order-dependent: dependencies must finish initializing
      // before their dependents, so this can't become a Promise.all().
      for (const [, instance] of container.getResolvedEntries()) {
        if (hasOnModuleInit(instance)) {
          await instance.onModuleInit();
        }
      }

      const app = new Application(container, controllers);

      // After every onModuleInit has finished, so a discovering provider can rely on all others being ready.
      for (const [, instance] of container.getResolvedEntries()) {
        if (hasOnApplicationBootstrap(instance)) {
          await instance.onApplicationBootstrap(app);
        }
      }

      return app;
    } catch (error) {
      await rollBack(container);
      throw error;
    }
  }

  /** Every singleton provider instance resolved at boot, with its token, in dependency order. Transient providers are never cached, so they don't appear. */
  resolved(): ReadonlyArray<readonly [Token, unknown]> {
    return this.#container.getResolvedEntries();
  }

  get<T>(token: Token<T>): T {
    return this.#container.get(token);
  }

  /**
   * Runs every `onApplicationShutdown` hook, dependents before their dependencies, even if one fails: a failing
   * flush must not leave the database pool open. One failure is rethrown as it is; several are reported together
   * in an `AggregateError`. Idempotent: the application counts as closed from the first call.
   */
  async close(signal?: string): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;

    // Same ordering constraint as create(), reversed: dependents shut down
    // before what they depend on.
    const failures = await runShutdownHooks(this.#container.getResolvedEntries().toReversed(), signal);
    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, `${failures.length} onApplicationShutdown hooks failed`);
    }
  }
}

/** Runs each `onApplicationShutdown` in `entries` order, one at a time, collecting failures instead of stopping at the first. */
async function runShutdownHooks(entries: ReadonlyArray<readonly [Token, unknown]>, signal: string | undefined): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const [, instance] of entries) {
    if (hasOnApplicationShutdown(instance)) {
      try {
        await instance.onApplicationShutdown(signal);
      } catch (error) {
        failures.push(error);
      }
    }
  }
  return failures;
}

/**
 * A boot that fails part-way has already built providers, and those may hold resources (a connection pool opened in
 * a constructor). Closes everything that was constructed, dependents first, with no signal since nothing stopped
 * it from outside. The boot's own error is what the caller needs to see, so failures here are logged, not thrown.
 */
async function rollBack(container: Container): Promise<void> {
  const failures = await runShutdownHooks(container.getResolvedEntries().toReversed(), undefined);
  for (const failure of failures) {
    console.error("[@blixis-io/core] an onApplicationShutdown hook failed while rolling back a failed boot:", failure);
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
