export { Application, createApplication, type CreateApplicationOptions } from "./application.js";
export { CoreError, DuplicateDynamicModuleError, NotAModuleError, ProviderNotVisibleError } from "./errors.js";
export {
  hasOnApplicationShutdown,
  hasOnModuleInit,
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
