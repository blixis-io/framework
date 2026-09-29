---
title: Why Legacy Decorators
description: Why Blixis uses experimentalDecorators + emitDecoratorMetadata instead of the new TC39 decorators standard.
sidebar:
  order: 1
---

If you've followed TypeScript's decorator story, this choice can look backwards: TypeScript 5+ supports the new [TC39 stage-3 decorators proposal](https://github.com/tc39/proposal-decorators) natively, no `experimentalDecorators` flag required, and it's the direction the language is actually heading. Blixis uses the *old* ("legacy") decorators anyway. The reason is a hard constraint, not inertia.

## The constraint: no parameter decorators

The TC39 stage-3 decorators proposal does not include parameter decorators. They were part of an earlier design and were dropped — there's a [separate proposal for class method and constructor parameter decorators](https://github.com/tc39/proposal-class-method-parameter-decorators), and as of this writing it's stalled at **stage 1**, with no consensus and no path to shipping soon.

Constructor-parameter injection —

```ts
@Injectable()
class UserService {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}
}
```

— is the entire ergonomic point of this style of dependency injection. Without parameter decorators, there's no `@Inject(token)` to override a specific parameter's resolution, and more fundamentally: the new decorators proposal has no mechanism at all for a class decorator to inspect its own constructor's parameter *types*. `emitDecoratorMetadata`'s `design:paramtypes` — the thing `@blixis/di`'s whole container is built on — is specifically tied to the legacy decorator emit path.

## What the alternative would look like

Frameworks built on the new decorators fall back to one of two patterns, neither of which is constructor injection:

- **Property injection**: `@inject(TOKEN) accessor service!: Service;` — using the new accessor decorators, with explicit tokens (no automatic type-based resolution, since there's no parameter reflection to read).
- **Explicit static metadata**: `static inject = [TOKEN_A, TOKEN_B] as const;` alongside a normal constructor, with a class decorator reading that static array instead of reflecting parameter types.

Both are viable designs. Neither is `constructor(private readonly db: Database) {}` — and that ergonomic is worth keeping.

## Confirmation this isn't just Blixis's problem

NestJS — the framework most directly comparable to this one, and considerably more mature — hits the identical wall. As of NestJS 10 and 11 (shipping mid-2026), the framework still requires legacy decorators plus `reflect-metadata` for exactly this reason; switching a NestJS project's `experimentalDecorators` flag off breaks DI resolution, route binding, pipes, and `class-validator` outright. NestJS has not shipped a stage-3-decorators-native major, for the same constraint described above.

## The tradeoff, honestly

Legacy decorators are a TypeScript-specific, non-standard emit path — they're not going to become a Web/ECMAScript standard, and `experimentalDecorators` has said "experimental" in its name since TypeScript 1.5. This is a real cost: Blixis is opting into a compiler-specific feature rather than a forward-looking language standard.

The alternative cost is losing constructor injection entirely, for a proposal that's been stalled at stage 1 for years with no committed timeline. Given the choice between "a stable, if non-standard, feature that does exactly what the framework needs" and "wait, possibly indefinitely, for a stage-1 proposal," Blixis chooses the former. If the parameter-decorators proposal ever reaches stage 3, this is worth revisiting — see [Toolchain Notes & Gotchas](/architecture/toolchain-notes/) for the current state of the broader TypeScript 7 toolchain this decision interacts with.
