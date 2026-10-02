import { defineMetadata, getMetadata, type Class } from "@blixis-io/di";

export interface ExecutionContext {
  request: Request;
  params: Readonly<Record<string, string>>;
  /** The controller class whose route is being handled. Read route metadata with `getRouteMetadata(KEY, context)`. */
  controller: Class;
  /** The name of the controller method handling this request. */
  handler: string | symbol;
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

const GLOBAL_GUARD = Symbol("blixis:global-guard");

/**
 * Marks a guard class as global: once it is registered as a provider, it runs on **every** route, before
 * the route's own `@UseGuards`. Found through the application's providers, so there is nothing else to
 * wire up. Several global guards run in dependency order; the first to deny stops the request.
 */
export function GlobalGuard(): ClassDecorator {
  return (target) => {
    defineMetadata(GLOBAL_GUARD, true, target);
  };
}

export function isGlobalGuard(target: object): boolean {
  return getMetadata<boolean>(GLOBAL_GUARD, target) === true;
}

/**
 * A decorator that attaches `value` under `key` to a controller (every route in it) or to one route, so a
 * guard or interceptor can read it with `getRouteMetadata`. `@Roles("admin")` and `@Public()` are built on this.
 */
export function SetRouteMetadata(key: symbol, value: unknown): ClassDecorator & MethodDecorator {
  const decorator = (target: object, propertyKey?: string | symbol): void => {
    if (propertyKey === undefined) {
      defineMetadata(key, value, target);
    } else {
      defineMetadata(key, value, target, propertyKey);
    }
  };
  return decorator;
}

/** What `SetRouteMetadata` stored for the route being handled: the method's own value if it has one, else the controller's. */
export function getRouteMetadata(key: symbol, context: Pick<ExecutionContext, "controller" | "handler">): unknown {
  const prototype: unknown = context.controller.prototype;
  const onMethod: unknown = typeof prototype === "object" && prototype !== null ? getMetadata(key, prototype, context.handler) : undefined;
  return onMethod ?? getMetadata(key, context.controller);
}
