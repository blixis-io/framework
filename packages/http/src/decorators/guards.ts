import { defineMetadata, getMetadata, type Class } from "@blixis-io/di";

export interface ExecutionContext {
  request: Request;
  params: Readonly<Record<string, string>>;
}

export interface CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}

const GUARDS = Symbol("blixis:guards");

/**
 * Applies guards to a controller (class position) or a single route
 * (method position) — the same decorator function works in both spots,
 * matching the shape TS's legacy decorators give it: a class decorator
 * receives no `propertyKey`, a method decorator does.
 */
export function UseGuards(...guards: Class<CanActivate>[]): ClassDecorator & MethodDecorator {
  const decorator = (target: object, propertyKey?: string | symbol): void => {
    if (propertyKey === undefined) {
      const existing = getMetadata<Class<CanActivate>[]>(GUARDS, target) ?? [];
      defineMetadata(GUARDS, [...existing, ...guards], target);
    } else {
      const existing = getMetadata<Class<CanActivate>[]>(GUARDS, target, propertyKey) ?? [];
      defineMetadata(GUARDS, [...existing, ...guards], target, propertyKey);
    }
  };
  return decorator;
}

export function getClassGuards(target: object): Class<CanActivate>[] {
  return getMetadata(GUARDS, target) ?? [];
}

export function getMethodGuards(target: object, propertyKey: string | symbol): Class<CanActivate>[] {
  return getMetadata(GUARDS, target, propertyKey) ?? [];
}
