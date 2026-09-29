import "reflect-metadata";

export type MetadataKey = string | symbol;

export function defineMetadata(
  key: MetadataKey,
  value: unknown,
  target: object,
  propertyKey?: MetadataKey,
): void {
  if (propertyKey === undefined) {
    Reflect.defineMetadata(key, value, target);
  } else {
    Reflect.defineMetadata(key, value, target, propertyKey);
  }
}

export function getMetadata<T>(key: MetadataKey, target: object, propertyKey?: MetadataKey): T | undefined {
  return propertyKey === undefined
    ? (Reflect.getMetadata(key, target) as T | undefined)
    : (Reflect.getMetadata(key, target, propertyKey) as T | undefined);
}

export function getOwnMetadata<T>(key: MetadataKey, target: object, propertyKey?: MetadataKey): T | undefined {
  return propertyKey === undefined
    ? (Reflect.getOwnMetadata(key, target) as T | undefined)
    : (Reflect.getOwnMetadata(key, target, propertyKey) as T | undefined);
}

export const DESIGN_PARAM_TYPES: MetadataKey = "design:paramtypes";
