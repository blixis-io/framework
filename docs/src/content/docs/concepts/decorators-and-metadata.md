---
title: Decorators & Metadata
description: How legacy decorators and reflect-metadata actually work under the hood.
sidebar:
  order: 2
---

Every `@`-decorator in Blixis — `@Injectable`, `@Module`, `@Controller`, `@Get`, `@Body` — is built on the same primitive: TypeScript's legacy decorator output plus [`reflect-metadata`](https://www.npmjs.com/package/reflect-metadata). This page explains that primitive directly, which makes every framework decorator's behavior predictable instead of magic.

## What a decorator actually is

A legacy TypeScript decorator is a plain function called once, at class-definition time, with arguments that depend on where it's applied:

- **Class decorator** — `(target: Function) => void`. `target` is the class itself.
- **Method decorator** — `(target: object, propertyKey: string | symbol, descriptor) => void`. `target` is the class's **prototype**, not the class.
- **Parameter decorator** — `(target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => void`. For a *constructor* parameter, `propertyKey` is `undefined`; for a method parameter, it's the method's name and `target` is the prototype, same as a method decorator.

Every decorator factory in Blixis (`Injectable()`, `Controller()`, `Get()`, ...) is a function that *returns* one of these, closing over whatever arguments you passed:

```ts
export function Injectable(options: InjectableOptions = {}): ClassDecorator {
  return (target) => {
    defineMetadata(INJECTABLE_OPTIONS, { scope: options.scope ?? "singleton" }, target);
  };
}
```

## Storing and reading metadata

`@blixis/di` exports thin typed wrappers over `Reflect.defineMetadata`/`Reflect.getMetadata`:

```ts
import { defineMetadata, getMetadata } from "@blixis/di";

defineMetadata(SOME_KEY, value, target, propertyKey?);
const value = getMetadata<T>(SOME_KEY, target, propertyKey?);
```

Metadata keys are `Symbol`s scoped to whichever module owns that piece of metadata — `@blixis/di` has its own private symbols for injectable options, inject overrides, and optional-parameter flags; `@blixis/http` has separate ones for routes, controllers, params, and guards. None of them collide, and none of them are exported — you always go through the decorator functions themselves or their paired `getXxx()` reader.

### The rule that's easy to get backwards: key by what the decorator receives

For **method**-scoped metadata (route definitions, param sources, per-method guards), the correct key is the **prototype** — exactly the `target` a method or parameter decorator already receives — never `target.constructor`. This matches how TypeScript's own `design:paramtypes` metadata for methods is stored, and how `reflect-metadata` is conventionally used everywhere else.

```ts
// Correct: store and read against the same prototype target
function Get(path = ""): MethodDecorator {
  return (target, propertyKey) => {
    defineMetadata(ROUTE, { path }, target, propertyKey);
  };
}
getMetadata(ROUTE, SomeController.prototype, "methodName");
```

Re-deriving the constructor (`target.constructor`) at write time and then reading back via the prototype (or vice versa) means write and read never see the same object, and the lookup silently returns `undefined` — no error, just metadata that appears to have never been set. This is a genuine, easy-to-make mistake (the framework's own test suite caught exactly this bug once during development); if a method decorator you write seems to have no effect, check this first.

**Class**-scoped metadata (like `@Injectable`'s scope, or `@Module`'s provider list) doesn't have this problem — a class decorator's `target` *is* the class/constructor directly, and reads happen against that same class, so there's only one object in play.

## `design:paramtypes`: what TypeScript actually emits

With `emitDecoratorMetadata` on, a **decorated** class gets an extra piece of compiler-generated metadata: an array of its constructor parameters' reflected types.

```ts
@Injectable()
class Consumer {
  constructor(public dep: Dep) {}
}
// Reflect.getMetadata("design:paramtypes", Consumer) === [Dep]
```

Three things about this array matter a lot in practice, all covered in depth in [Toolchain Notes & Gotchas](/architecture/toolchain-notes/):

1. It only exists if the class has **at least one class decorator** — an undecorated class has no `design:paramtypes` at all, which is exactly why `@Injectable()` is required (see [Dependency Injection](/concepts/dependency-injection/)).
2. A parameter typed with an interface, a union, or referencing a not-yet-declared class erases to the `Object` constructor — TypeScript can't put a runtime value for something that doesn't exist at runtime.
3. A parameter typed `void` is the one case that erases to a literal `undefined` entry instead of `Object`.

`@blixis/di`'s `UnresolvableParameterError` exists specifically to turn cases 2 and 3 into an actionable error message instead of a confusing `NotInjectableError` or a silent wrong resolution.

## Next

- How the container consumes all of this to build instances: [Dependency Injection](/concepts/dependency-injection/).
- Every exported metadata helper: [`@blixis/di` reference](/reference/blixis-di/).
