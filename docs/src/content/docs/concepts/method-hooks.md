---
title: Method Hooks
description: "@Before, @After, and @Around — before/after/around method interception via plain decorators, no container involved."
sidebar:
  order: 15
---

`@blixis-io/method-hooks` wraps a method's own implementation with `@Before`, `@After`, and `@Around` decorators. These are **method hooks, not a plugin/extension system** — nothing here lets one package attach behavior to another package's class without editing its source; you apply these directly on a method in a class you own. That's a deliberately lighter design than the alternative: a plugin class registered separately, targeting another class's method by reference (true AOP, proxying resolved instances through the DI container) would need `@blixis-io/http`'s `ExecutionContext`-style route awareness generalized to arbitrary methods — a bigger, more magical mechanism this framework hasn't needed yet. `@Before`/`@After`/`@Around` use the same before/after/around vocabulary Magento's plugin system popularized, but cover the same three interception shapes with no framework changes at all and no claim to being an external extension point.

Works on **any** class, `@Injectable()`-managed or not — there's no DI container involvement. Wrapping happens once, at class-decoration time, by directly replacing the method's implementation.

## The three shapes

```ts
import { After, Around, Before } from "@blixis-io/method-hooks";

@Injectable()
class PostsService {
  @Before((input: CreatePostInput) => {
    console.log("creating post", input.title);
  })
  @Around((next: (input: CreatePostInput) => Post, input: CreatePostInput) => {
    const start = performance.now();
    const result = next(input);
    console.log("took", performance.now() - start, "ms");
    return result;
  })
  create(input: CreatePostInput): Post {
    // ...
  }
}
```

- **`@Before(hook)`** runs `hook(...args)` first. Returning an array replaces the arguments the original method is called with; returning nothing leaves them unchanged.
- **`@After(hook)`** runs the original first, then `hook(result, ...args)` — `hook` must return the result to use (no "return nothing to leave it unchanged" shorthand, since a method can legitimately return `undefined` itself).
- **`@Around(hook)`** wraps the method entirely. `hook` receives a `next` function and decides whether (and how) to call it — skip it to short-circuit, call it more than once, or pass different arguments than it received. Calling `next()` bare replays the original arguments, same convention as [`Interceptor.next()`](/concepts/interceptors/).

Any hook may be `async` — the decorated method becomes effectively async at runtime whenever a hook is, exactly like a [`CanActivate`](/concepts/guards-and-authorization/) guard returning `Promise<boolean>` instead of `boolean`. One real caveat: TypeScript can't change a method's *static* return type from a legacy decorator, only its runtime behavior — if you add an async `@Before` to a method TypeScript still thinks returns `number`, callers see `number` at the type level even though it's actually a `Promise<number>` at runtime. Awaiting it directly still works; TypeScript just won't flag the `await` as necessary.

Async detection is duck-typed (anything with a `.then` method), not `instanceof Promise` — a real `Promise` minted in a different realm (a worker, a vm context, a bundled polyfill) is still fully spec-compliant but fails `instanceof` against this realm's own `Promise` constructor. `@Before`'s `BeforeHook` and `@After`'s `AfterHook` types are declared as `PromiseLike<T>`, not `Promise<T>`, for the same reason.

## Stacking order

Multiple decorators on one method compose exactly like nested function calls — read top-to-bottom in source, **each decorator wraps everything below it**:

```ts
@Before(logStart)   // pre-logic runs 1st
@After(logEnd)      // post-logic runs 5th (last)
@Around(withTiming) // pre-logic runs 2nd, post-logic runs 4th
create(input: CreatePostInput): Post {
  // runs 3rd
}
```

`@Before`'s own logic only ever runs on the way *in* (nothing happens on the way back out); `@After`'s only ever runs on the way *out*; `@Around` can do both, on either side of its own `next()` call. This is the same rule TypeScript decorators (and Python's) always follow when stacked — nothing `@blixis-io/method-hooks`-specific — spelled out here because it's easy to get backwards on first read.

## Known limitation

Only works on real prototype methods, the same as every other method decorator in this framework (`@Get`, `@UseGuards`, etc.) — not an arrow-function class field (`create = (input) => {}`), since legacy decorators can't wrap those.

## Next

- Every exported symbol: [`@blixis-io/method-hooks` reference](/reference/blixis-method-hooks/).
- A worked example built step by step: [Tutorial: Extend Behavior with Method Hooks](/tutorials/extend-with-hooks/).
- The closest existing analog in this framework: [Interceptors](/concepts/interceptors/) — same `next()`-based wrapping idea, scoped to HTTP routes instead of arbitrary methods.
