import { defineMetadata, getMetadata } from "@blixis/di";
import type { HttpMethod } from "../types.js";

export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  propertyKey: string | symbol;
}

const ROUTES = Symbol("blixis:routes");
const HTTP_CODE = Symbol("blixis:http-code");

function routeDecorator(method: HttpMethod, path: string): MethodDecorator {
  return (target, propertyKey) => {
    const ctor = target.constructor;
    const routes = getMetadata<RouteDefinition[]>(ROUTES, ctor) ?? [];
    routes.push({ method, path, propertyKey });
    defineMetadata(ROUTES, routes, ctor);
  };
}

export const Get = (path = ""): MethodDecorator => routeDecorator("GET", path);
export const Post = (path = ""): MethodDecorator => routeDecorator("POST", path);
export const Put = (path = ""): MethodDecorator => routeDecorator("PUT", path);
export const Patch = (path = ""): MethodDecorator => routeDecorator("PATCH", path);
export const Delete = (path = ""): MethodDecorator => routeDecorator("DELETE", path);

export function getRoutes(target: object): RouteDefinition[] {
  return getMetadata(ROUTES, target) ?? [];
}

/** Overrides the default 200 (or 204 for an `undefined` return) status for one route. */
export function HttpCode(code: number): MethodDecorator {
  return (target, propertyKey) => {
    defineMetadata(HTTP_CODE, code, target, propertyKey);
  };
}

export function getHttpCode(target: object, propertyKey: string | symbol): number | undefined {
  return getMetadata(HTTP_CODE, target, propertyKey);
}
