export interface OnModuleInit {
  onModuleInit(): void | Promise<void>;
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
