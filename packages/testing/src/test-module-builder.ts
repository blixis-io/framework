import type { ModuleMetadata } from "@blixis/core";
import { Module } from "@blixis/core";
import type { ClassProvider, ExistingProvider, FactoryProvider, Provider, Token, ValueProvider } from "@blixis/di";
import { createHttpApplication, type HttpApplicationOptions } from "@blixis/http";
import { TestApplication } from "./test-application.js";

export type OverrideDefinition<T> =
  | Omit<ClassProvider<T>, "provide">
  | Omit<ValueProvider<T>, "provide">
  | Omit<FactoryProvider<T>, "provide">
  | Omit<ExistingProvider<T>, "provide">;

export class TestModuleBuilder {
  #metadata: ModuleMetadata;
  #overrides: Provider[] = [];

  constructor(metadata: ModuleMetadata) {
    this.#metadata = metadata;
  }

  /** Replaces the provider registered under `token` with `definition`, applied before the module graph resolves. */
  override<T>(token: Token<T>, definition: OverrideDefinition<T>): this {
    this.#overrides.push({ provide: token, ...definition });
    return this;
  }

  async compile(options: Omit<HttpApplicationOptions, "overrides"> = {}): Promise<TestApplication> {
    @Module(this.#metadata)
    class TestRootModule {}

    const app = await createHttpApplication(TestRootModule, { ...options, overrides: this.#overrides });
    return new TestApplication(app);
  }
}

export const Test = {
  createModule(metadata: ModuleMetadata = {}): TestModuleBuilder {
    return new TestModuleBuilder(metadata);
  },
};
