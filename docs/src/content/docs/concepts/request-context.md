---
title: Request Context
description: Per-request state shared between a guard and the controller/service handling the same request.
sidebar:
  order: 12
---

`RequestContext` is a small key/value store, scoped to a single request, that any DI-resolved class can inject — a guard sets something during `canActivate`, and a controller or service further down the same request reads it back.

## Why not a request-scoped provider

Most DI frameworks solve this with a "request" scope: a provider rebuilt fresh for every request. Blixis doesn't have one, on purpose — every provider (controllers included) is resolved **once**, at [application boot](/concepts/lifecycle-hooks/), not per request. A singleton controller's constructor only ever runs once, so it can't receive a freshly-built value each request the way a request-scoped provider would promise.

`RequestContext` sidesteps this: it's a normal **singleton**, injected once like anything else. What changes per request isn't the instance — it's which internal store its methods read and write, tracked via Node's `AsyncLocalStorage`. `createHttpApplication` wraps every request in a fresh store automatically; you never call that wrapping yourself.

## A guard sets it, a service reads it

```ts
import { Injectable } from "@blixis/di";
import { RequestContext, type CanActivate, type ExecutionContext } from "@blixis/http";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly ctx: RequestContext) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = context.request.headers.get("x-api-key") === "dev-secret";
    if (allowed) {
      this.ctx.set("apiClient", "dev-cli");
    }
    return allowed;
  }
}
```

```ts
@Injectable()
export class PostsService {
  constructor(
    @Inject(LOGGER) private readonly log: Logger,
    private readonly ctx: RequestContext,
  ) {}

  remove(id: string): void {
    // ...
    const apiClient = this.ctx.get<string>("apiClient") ?? "unknown";
    this.log.info("post deleted", { postId: id, apiClient });
  }
}
```

Both classes inject `RequestContext` like any other provider — no module needs to list it, since `createHttpApplication` registers it globally for every app. The guard runs first (guards always run before the controller method), so by the time `PostsService.remove()` executes, `apiClient` is already there. This is the actual `ApiKeyGuard`/`PostsService` pair from [hello-api](/examples/hello-api-walkthrough/) — run it and delete a post with and without `x-api-key`, and compare the two log lines.

## `get`/`has` vs. `set` outside a request

```ts
ctx.get("user"); // undefined — a legitimate "no request, so no value" answer
ctx.has("user"); // false, same reasoning
ctx.set("user", value); // throws RequestContextError — this one's a bug, not a valid state
```

Reading outside a request scope isn't necessarily wrong — a service might be shared between HTTP handling and some other entry point, and "is there a current user" has an honest answer of "no" either way. Writing outside a request scope has no honest answer: there's no request for the value to belong to, so `set()` throws instead of silently doing nothing.

## Isolation between requests

Two requests handled concurrently never see each other's values — each gets its own store for the full lifetime of that request, including anything it `await`s. You don't need to do anything for this; it falls out of `AsyncLocalStorage` and the fact that `createHandler` wraps each incoming request in its own scope before guards even run.

## Next

- Every exported symbol: [`@blixis/http` reference](/reference/blixis-http/#requestcontext).
- How the guard that sets it fits into the request lifecycle: [Guards & Authorization](/concepts/guards-and-authorization/).
- See it wired into a real app: the [hello-api walkthrough](/examples/hello-api-walkthrough/).
