import { defineMetadata, getMetadata } from "@blixis-io/di";

const CONTROLLER_PREFIX = Symbol("blixis:controller-prefix");

function stripSlashes(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

export function Controller(prefix = ""): ClassDecorator {
  return (target) => {
    defineMetadata(CONTROLLER_PREFIX, stripSlashes(prefix), target);
  };
}

export function getControllerPrefix(target: object): string | undefined {
  return getMetadata(CONTROLLER_PREFIX, target);
}
