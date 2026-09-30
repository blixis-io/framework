import { defineMetadata, getMetadata, type Class } from "@blixis-io/di";
import type { ExecutionContext } from "./guards.js";

export interface Interceptor {
  intercept(context: ExecutionContext, next: () => Promise<Response>): Response | Promise<Response>;
}

const INTERCEPTORS = Symbol("blixis:interceptors");

/**
 * Applies interceptors to a controller (class position) or a single route
 * (method position) — same dual-shape decorator as `@UseGuards`. Interceptors
 * wrap param resolution + handler invocation (guards already ran and
 * already decided the request is allowed through); class-level interceptors
 * wrap outermost, method-level innermost, closest to the handler.
 */
export function UseInterceptors(...interceptors: Class<Interceptor>[]): ClassDecorator & MethodDecorator {
  const decorator = (target: object, propertyKey?: string | symbol): void => {
    if (propertyKey === undefined) {
      const existing = getMetadata<Class<Interceptor>[]>(INTERCEPTORS, target) ?? [];
      defineMetadata(INTERCEPTORS, [...existing, ...interceptors], target);
    } else {
      const existing = getMetadata<Class<Interceptor>[]>(INTERCEPTORS, target, propertyKey) ?? [];
      defineMetadata(INTERCEPTORS, [...existing, ...interceptors], target, propertyKey);
    }
  };
  return decorator;
}

export function getClassInterceptors(target: object): Class<Interceptor>[] {
  return getMetadata(INTERCEPTORS, target) ?? [];
}

export function getMethodInterceptors(target: object, propertyKey: string | symbol): Class<Interceptor>[] {
  return getMetadata(INTERCEPTORS, target, propertyKey) ?? [];
}
