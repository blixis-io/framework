---
title: Interceptors
description: "@UseInterceptors, wrapping the call chain around a handler for logging, timing, and response transformation."
sidebar:
  order: 7.5
---

An interceptor wraps a route's param resolution and handler invocation in an onion layer — code before `next()` runs before the handler, code after runs after, and it can inspect or replace the `Response` either side returns. Interceptors are DI-resolved classes, same shape as [guards](/concepts/guards-and-authorization/), and run **after** guards: a denied request never reaches an interceptor at all.

## `Interceptor`

```ts
import type { ExecutionContext, Interceptor } from "@blixis-io/http";
import { Inject, Injectable } from "@blixis-io/di";
import { LOGGER, type Logger } from "@blixis-io/logging";

@Injectable()
export class TimingInterceptor implements Interceptor {
  constructor(@Inject(LOGGER) private readonly log: Logger) {}

  async intercept(context: ExecutionContext, next: () => Promise<Response>): Promise<Response> {
    const start = performance.now();
    const response = await next();
    const ms = Math.round(performance.now() - start);
    this.log.info("request handled", { method: context.request.method, ms });
    return response;
  }
}
```

`next()` calls the next interceptor in the chain, or the actual handler once every interceptor has run — call it exactly once, same as any onion middleware. Skipping the call (returning your own `Response` instead) short-circuits the handler entirely, which is how a caching interceptor would work.

## `@UseInterceptors`

Applies at the controller level (every route) or the method level (just that route) — same dual-position decorator as `@UseGuards`:

```ts
@UseInterceptors(TimingInterceptor)
@Controller("posts")
export class PostsController {
  @UseInterceptors(CacheInterceptor)
  @Get()
  list() { /* TimingInterceptor wraps CacheInterceptor wraps list() */ }
}
```

Class-level interceptors wrap **outermost**, method-level **innermost** — the class-level one sees the full round trip (including any transformation a method-level interceptor already made), the method-level one is the layer closest to the actual handler call.

## Registered providers, same rule as guards

`@UseInterceptors(TimingInterceptor)` only records which class to ask the DI container for at request time — `TimingInterceptor` still needs to be in the owning module's `providers`, exactly like a guard. See [Guards & Authorization](/concepts/guards-and-authorization/#guard-classes-must-be-registered-providers) for why.

## Observing (and rethrowing) an error

`next()` rejects if the handler — or a guard-adjacent step like body validation — throws. An interceptor that doesn't care about errors can ignore this (its own `await next()` just propagates the rejection upward, same as if the interceptor weren't there). One that wants to observe errors — for logging, say — can wrap it:

```ts
async intercept(context: ExecutionContext, next: () => Promise<Response>): Promise<Response> {
  try {
    return await next();
  } catch (error) {
    this.log.error("request failed", { error });
    throw error; // still becomes the usual problem+json response
  }
}
```

Rethrowing is important — swallowing the error here would turn a real failure into whatever `intercept` returns instead, which is very rarely what you want.

## Next

- Every exported symbol: [`@blixis-io/http` reference](/reference/blixis-http/#interceptors).
- See a real one (`TimingInterceptor`, logging request duration) wired into `hello-api`: the [hello-api walkthrough](/examples/hello-api-walkthrough/).
- Reading a value a guard set, from inside an interceptor or handler: [Request Context](/concepts/request-context/).
