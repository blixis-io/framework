import { defineMetadata, getMetadata, type Class, type Provider, type Token } from "@blixis/di";

export interface ModuleMetadata {
  imports?: ModuleRef[];
  providers?: Provider[];
  controllers?: Class[];
  /** Tokens (from `providers`) visible to modules that directly import this one. Anything not listed here stays private to this module. */
  exports?: Token[];
  /** Makes every exported token visible to every module in the graph, without each one needing to import this module directly — for app-wide infra like logging/config. */
  global?: boolean;
}

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
