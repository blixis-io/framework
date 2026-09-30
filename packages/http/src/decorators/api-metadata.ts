import { defineMetadata, getMetadata } from "@blixis/di";

export interface ApiOperationOptions {
  summary?: string;
  description?: string;
  /** Defaults to `${ControllerName}_${methodName}` when omitted — every operation needs a unique one, valid or not. */
  operationId?: string;
}

const API_OPERATION = Symbol("blixis:api-operation");
const API_TAGS = Symbol("blixis:api-tags");

/** Documents one route for `@blixis/openapi` — entirely optional, a route without it still gets a valid (derived) operationId. */
export function ApiOperation(options: ApiOperationOptions): MethodDecorator {
  return (target, propertyKey) => {
    defineMetadata(API_OPERATION, options, target, propertyKey);
  };
}

export function getApiOperation(target: object, propertyKey: string | symbol): ApiOperationOptions | undefined {
  return getMetadata(API_OPERATION, target, propertyKey);
}

/**
 * Applies OpenAPI tags to a controller (class position) or a single route
 * (method position) — same dual-shape decorator as `@UseGuards`. Class-level
 * and method-level tags both apply, concatenated, not one replacing the
 * other.
 */
export function ApiTags(...tags: string[]): ClassDecorator & MethodDecorator {
  const decorator = (target: object, propertyKey?: string | symbol): void => {
    if (propertyKey === undefined) {
      const existing = getMetadata<string[]>(API_TAGS, target) ?? [];
      defineMetadata(API_TAGS, [...existing, ...tags], target);
    } else {
      const existing = getMetadata<string[]>(API_TAGS, target, propertyKey) ?? [];
      defineMetadata(API_TAGS, [...existing, ...tags], target, propertyKey);
    }
  };
  return decorator;
}

export function getClassApiTags(target: object): string[] {
  return getMetadata(API_TAGS, target) ?? [];
}

export function getMethodApiTags(target: object, propertyKey: string | symbol): string[] {
  return getMetadata(API_TAGS, target, propertyKey) ?? [];
}
