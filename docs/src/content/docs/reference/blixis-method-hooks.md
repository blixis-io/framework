---
title: "@blixis-io/method-hooks"
description: Full API reference for the method-hooks package.
sidebar:
  order: 9
---

`@Before`/`@After`/`@Around` method decorators — no DI container involvement, works on any class. See [Method Hooks](/concepts/method-hooks/) for the concepts and the stacking-order rule.

## `Before(hook)`

```ts
function Before<Args extends unknown[] = unknown[]>(hook: BeforeHook<Args>): MethodDecorator;

type BeforeHook<Args extends unknown[] = unknown[]> = (
  ...args: Args
) => Args | void | PromiseLike<Args | void>;
```

Runs `hook` before the decorated method. Returning an array replaces the arguments the method is called with; returning `undefined` (or nothing) leaves them unchanged. `hook` may be `async` — detected by duck-typing (`.then` presence), not `instanceof Promise`, so a thenable from a different realm still works.

```ts
@Before((input: CreatePostInput) => {
  console.log("creating", input.title);
})
create(input: CreatePostInput): Post { /* ... */ }
```

## `After(hook)`

```ts
function After<Result = unknown, Args extends unknown[] = unknown[]>(hook: AfterHook<Result, Args>): MethodDecorator;

type AfterHook<Result = unknown, Args extends unknown[] = unknown[]> = (
  result: Result,
  ...args: Args
) => Result | PromiseLike<Result>;
```

Runs `hook` after the decorated method, with its result (awaited first, if the method returned a `Promise`) and its original arguments. Must return the result to use.

```ts
@After((result: Post) => ({ ...result, title: result.title.trim() }))
create(input: CreatePostInput): Post { /* ... */ }
```

## `Around(hook)`

```ts
function Around<Result = unknown, Args extends unknown[] = unknown[]>(hook: AroundHook<Result, Args>): MethodDecorator;

type AroundHook<Result = unknown, Args extends unknown[] = unknown[]> = (
  next: NextFn<Args, Result>,
  ...args: Args
) => Result;

type NextFn<Args extends unknown[], Result> = (...args: Args) => Result;
```

Wraps the decorated method entirely. `hook` decides whether (and how) to call `next` — skip it to short-circuit, call it more than once, or pass it different arguments. Calling `next()` with no arguments replays whatever the decorated method was actually called with (same convention as [`Interceptor.next()`](/reference/blixis-http/)).

```ts
@Around((next: (input: CreatePostInput) => Post, input: CreatePostInput) => {
  const start = performance.now();
  const result = next(input);
  console.log("took", performance.now() - start, "ms");
  return result;
})
create(input: CreatePostInput): Post { /* ... */ }
```

## Composing multiple decorators

Stacking `@Before`/`@After`/`@Around` on one method composes them like nested function calls — see [Method Hooks#stacking-order](/concepts/method-hooks/#stacking-order) for the exact rule and a worked example.
