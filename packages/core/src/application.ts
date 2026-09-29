import { Container, providerToken, type Class, type Provider, type Token } from "@blixis/di";
import { NotAModuleError } from "./errors.js";
import { hasOnApplicationShutdown, hasOnModuleInit } from "./lifecycle.js";
import { getModuleMetadata, isDynamicModule, moduleClassOf, type ModuleRef } from "./module.js";

function collectModuleGraph(root: ModuleRef, container: Container, overrides: readonly Provider[]): Class[] {
  const visited = new Set<Class>();
  const controllers: Class[] = [];
  const overridesByToken = new Map<Token, Provider>(overrides.map((override) => [providerToken(override), override]));
  visitModule(root, container, visited, controllers, overridesByToken);
  return controllers;
}

function visitModule(
  ref: ModuleRef,
  container: Container,
  visited: Set<Class>,
  controllers: Class[],
  overridesByToken: ReadonlyMap<Token, Provider>,
): void {
  const moduleClass = moduleClassOf(ref);
  if (visited.has(moduleClass)) {
    return;
  }
  visited.add(moduleClass);

  const staticMetadata = getModuleMetadata(moduleClass);
  if (!staticMetadata) {
    throw new NotAModuleError(moduleClass);
  }

  const dynamicMetadata = isDynamicModule(ref) ? ref : undefined;
  const imports = [...(staticMetadata.imports ?? []), ...(dynamicMetadata?.imports ?? [])];
  const providers = [...(staticMetadata.providers ?? []), ...(dynamicMetadata?.providers ?? [])];
  const moduleControllers = [...(staticMetadata.controllers ?? []), ...(dynamicMetadata?.controllers ?? [])];

  for (const importRef of imports) {
    visitModule(importRef, container, visited, controllers, overridesByToken);
  }
  for (const provider of providers) {
    container.register(overridesByToken.get(providerToken(provider)) ?? provider);
  }
  for (const controller of moduleControllers) {
    container.register(controller);
    controllers.push(controller);
  }
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
    const container = new Container();
    const controllers = collectModuleGraph(rootModule, container, options.overrides ?? []);

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
  /** Providers to swap in for the module graph's own, matched by token — the seam `@blixis/testing` uses for mocking. */
  overrides?: Provider[] | undefined;
}

export async function createApplication(
  rootModule: ModuleRef,
  options: CreateApplicationOptions = {},
): Promise<Application> {
  return Application.create(rootModule, options);
}
