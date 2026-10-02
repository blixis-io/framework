import type { Token } from "@blixis-io/di";

export interface OnModuleInit {
  onModuleInit(): void | Promise<void>;
}

/** What `onApplicationBootstrap` receives: the running application, as far as discovery needs it. */
export interface BootstrapContext {
  /** Every singleton provider instance resolved at boot, with its token, in dependency order. */
  resolved(): ReadonlyArray<readonly [Token, unknown]>;
  get<T>(token: Token<T>): T;
}

/**
 * Runs once every provider has been created and every `onModuleInit` has finished. This is the hook for
 * *discovery*: scanning `app.resolved()` for providers carrying a decorator (event handlers, commands)
 * and wiring them up. Unlike `onModuleInit`, all other providers are guaranteed to be initialized here.
 */
export interface OnApplicationBootstrap {
  onApplicationBootstrap(app: BootstrapContext): void | Promise<void>;
}

export interface OnApplicationShutdown {
  onApplicationShutdown(signal?: string): void | Promise<void>;
}

export function hasOnModuleInit(instance: unknown): instance is OnModuleInit {
  return (
    typeof instance === "object" &&
    instance !== null &&
    typeof (instance as Partial<OnModuleInit>).onModuleInit === "function"
  );
}

export function hasOnApplicationShutdown(instance: unknown): instance is OnApplicationShutdown {
  return (
    typeof instance === "object" &&
    instance !== null &&
    typeof (instance as Partial<OnApplicationShutdown>).onApplicationShutdown === "function"
  );
}

export function hasOnApplicationBootstrap(instance: unknown): instance is OnApplicationBootstrap {
  return (
    typeof instance === "object" &&
    instance !== null &&
    typeof (instance as Partial<OnApplicationBootstrap>).onApplicationBootstrap === "function"
  );
}
