import { assertSingleInstance } from "@blixis-io/di";

assertSingleInstance("@blixis-io/core", import.meta.url);

export { Application, createApplication, type CreateApplicationOptions } from "./application.js";
export { CoreError, NotAModuleError, ProviderNotVisibleError } from "./errors.js";
export {
  hasOnApplicationBootstrap,
  hasOnApplicationShutdown,
  hasOnModuleInit,
  type BootstrapContext,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "./lifecycle.js";
export {
  getModuleMetadata,
  isDynamicModule,
  Module,
  moduleClassOf,
  type DynamicModule,
  type ModuleMetadata,
  type ModuleRef,
} from "./module.js";
