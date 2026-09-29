import { defineMetadata, getMetadata, type Class, type Provider } from "@blixis/di";

export interface ModuleMetadata {
  imports?: ModuleRef[];
  providers?: Provider[];
  controllers?: Class[];
}

/**
 * The `forRoot()`-style escape hatch: a module class plus extra
 * imports/providers/controllers computed at import time (e.g. from config
 * passed to `DatabaseModule.forRoot(options)`), merged with whatever that
 * class's own `@Module()` declares.
 */
export interface DynamicModule extends ModuleMetadata {
  module: Class;
}

export type ModuleRef = Class | DynamicModule;

const MODULE_METADATA = Symbol("blixis:module-metadata");

export function Module(metadata: ModuleMetadata = {}): ClassDecorator {
  return (target) => {
    defineMetadata(MODULE_METADATA, metadata, target);
  };
}

export function getModuleMetadata(target: object): ModuleMetadata | undefined {
  return getMetadata(MODULE_METADATA, target);
}

export function isDynamicModule(ref: ModuleRef): ref is DynamicModule {
  return typeof ref === "object" && ref !== null && "module" in ref;
}

export function moduleClassOf(ref: ModuleRef): Class {
  return isDynamicModule(ref) ? ref.module : ref;
}
