/**
 * Calls whatever is inward of an `Around` hook — the original method, or
 * the next `Around` hook closer to it. Called with no arguments, it
 * replays whatever arguments the decorated method was actually called
 * with (same convention as `@blixis/http`'s `Interceptor.next()`); pass
 * explicit arguments to override them.
 */
export type NextFn<Args extends unknown[], Result> = (...args: Args) => Result;

/**
 * Runs before the original method. Returning an array replaces the
 * arguments the original method is called with; returning nothing (or
 * `undefined`) leaves them unchanged. May be async — the wrapped method
 * becomes effectively async too in that case, same as a `CanActivate`
 * guard returning `Promise<boolean>`.
 */
export type BeforeHook<Args extends unknown[] = unknown[]> = (...args: Args) => Args | void | Promise<Args | void>;

/**
 * Runs after the original method, receiving its (already-awaited) result.
 * Must return the result to use — there's no "return nothing to leave it
 * unchanged" shorthand, since that would be ambiguous for a method whose
 * real result is legitimately `undefined`.
 */
export type AfterHook<Result = unknown, Args extends unknown[] = unknown[]> = (
  result: Result,
  ...args: Args
) => Result | Promise<Result>;

/**
 * Wraps the original method entirely. Call `next(...)` to invoke whatever
 * is inward (the original method, or the next `Around` hook); skip calling
 * it to short-circuit. `next` can be called with different arguments than
 * this hook received, zero times, or more than once.
 */
export type AroundHook<Result = unknown, Args extends unknown[] = unknown[]> = (
  next: NextFn<Args, Result>,
  ...args: Args
) => Result;

function methodOf(descriptor: PropertyDescriptor): (...args: unknown[]) => unknown {
  return descriptor.value as (...args: unknown[]) => unknown;
}

/**
 * Runs `hook` before the decorated method, optionally replacing its
 * arguments. Composes with other `@Before`/`@After`/`@Around` decorators on
 * the same method by wrapping whatever's already there — see
 * `concepts/method-plugins.md` for the resulting call order when several
 * are stacked.
 */
export function Before<Args extends unknown[] = unknown[]>(hook: BeforeHook<Args>): MethodDecorator {
  return (_target: object, _propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const original = methodOf(descriptor);
    descriptor.value = function (this: unknown, ...args: unknown[]): unknown {
      const maybeNewArgs = hook(...(args as Args));
      if (maybeNewArgs instanceof Promise) {
        return maybeNewArgs.then((resolved) => original.apply(this, resolved ?? args));
      }
      return original.apply(this, maybeNewArgs ?? args);
    };
    return descriptor;
  };
}

/**
 * Runs `hook` after the decorated method, with its (awaited, if it
 * returned a `Promise`) result — `hook` must return the result to use.
 */
export function After<Result = unknown, Args extends unknown[] = unknown[]>(
  hook: AfterHook<Result, Args>,
): MethodDecorator {
  return (_target: object, _propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const original = methodOf(descriptor);
    descriptor.value = function (this: unknown, ...args: unknown[]): unknown {
      const result = original.apply(this, args) as Result | Promise<Result>;
      if (result instanceof Promise) {
        return result.then((resolved) => hook(resolved, ...(args as Args)));
      }
      return hook(result, ...(args as Args));
    };
    return descriptor;
  };
}

/**
 * Wraps the decorated method entirely with `hook`, which controls whether
 * (and how) the original method — or the next `Around` hook inward — runs
 * at all via the `next` function it's given.
 */
export function Around<Result = unknown, Args extends unknown[] = unknown[]>(
  hook: AroundHook<Result, Args>,
): MethodDecorator {
  return (_target: object, _propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const original = methodOf(descriptor);
    descriptor.value = function (this: unknown, ...args: unknown[]): unknown {
      // Calling next() bare replays the original args, same as
      // @blixis/http's Interceptor.next() — the common case is "just
      // continue," not "recompute every argument." Passing explicit
      // arguments still overrides them.
      const next: NextFn<Args, Result> = (...nextArgs: Args) =>
        original.apply(this, nextArgs.length > 0 ? nextArgs : args) as Result;
      return hook(next, ...(args as Args));
    };
    return descriptor;
  };
}
