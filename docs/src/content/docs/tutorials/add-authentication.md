---
title: "Tutorial: Add Authentication"
description: Protect the write routes of the blog API from Build Your First API with a DI-injected auth guard.
sidebar:
  order: 2
---

This continues the blog API from [Build Your First API](/framework/tutorials/build-your-first-api/), adding token-based auth to the routes that change data (`POST`, `PATCH`, `DELETE`) while leaving reads (`GET`) open. Read [Guards & Authorization](/framework/concepts/guards-and-authorization/) alongside this if anything here is unfamiliar.

## 1. A (fake) user store

A real app would check a database or an identity provider; this tutorial uses a hardcoded token so the auth *mechanism* stays the focus:

```ts title="src/auth/auth.service.ts"
import { Injectable } from "@blixis-io/di";

@Injectable()
export class AuthService {
  // Stand-in for a real token store / identity provider.
  #validTokens = new Set(["dev-secret-token"]);

  verifyToken(token: string | null): boolean {
    return token !== null && this.#validTokens.has(token);
  }
}
```

## 2. The guard

```ts title="src/auth/auth.guard.ts"
import { Injectable } from "@blixis-io/di";
import type { CanActivate, ExecutionContext } from "@blixis-io/http";
import { AuthService } from "./auth.service.js";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const header = context.request.headers.get("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    return this.auth.verifyToken(token);
  }
}
```

Notice `AuthGuard` takes `AuthService` as a constructor parameter, exactly like any other injectable class — guards aren't a special case for DI, they're ordinary providers that happen to implement `CanActivate`.

## 3. An auth module

```ts title="src/auth/auth.module.ts"
import { Module } from "@blixis-io/core";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";

@Module({
  providers: [AuthService, AuthGuard],
})
export class AuthModule {}
```

No controllers here — this module exists purely to provide `AuthService`/`AuthGuard` to whatever imports it.

## 4. Wire it in

```ts title="src/app.module.ts"
import { Module } from "@blixis-io/core";
import { AuthModule } from "./auth/auth.module.js";
import { PostsModule } from "./posts/posts.module.js";

@Module({ imports: [AuthModule, PostsModule] })
export class AppModule {}
```

`AuthModule` being imported into the root is what makes `AuthGuard` resolvable from anywhere — remember, `@UseGuards` only records *which class* to ask for, it doesn't register it (see [Guards & Authorization](/framework/concepts/guards-and-authorization/#guard-classes-must-be-registered-providers)). If you get this step wrong, you won't find out until the very first request hits a guarded route.

## 5. Protect the write routes

```ts title="src/posts/posts.controller.ts" ins={1,10,17,24}
import { UseGuards } from "@blixis-io/http";
// ...other imports

@Controller("posts")
export class PostsController {
  @Get()
  list() { /* unchanged — no guard */ }

  @Get(":id")
  get(@Param("id") id: string) { /* unchanged — no guard */ }

  @UseGuards(AuthGuard)
  @Post()
  @HttpCode(201)
  create(@Body(CreatePostSchema) input: CreatePostInput) { /* unchanged body */ }

  @UseGuards(AuthGuard)
  @Patch(":id")
  update(@Param("id") id: string, @Body(UpdatePostSchema) input: UpdatePostInput) { /* unchanged body */ }

  @UseGuards(AuthGuard)
  @Delete(":id")
  remove(@Param("id") id: string): undefined { /* unchanged body */ }
}
```

## 6. Try it

```bash
# No token: denied
curl -i -X DELETE localhost:3000/posts/1
# → 403 Forbidden

# Wrong token: still denied
curl -i -X DELETE localhost:3000/posts/1 -H 'authorization: Bearer wrong'
# → 403 Forbidden

# Correct token: allowed
curl -i -X DELETE localhost:3000/posts/1 -H 'authorization: Bearer dev-secret-token'
# → 204 No Content

# Reads never needed a token
curl localhost:3000/posts
# → 200, unaffected
```

## 7. Test it without curl

```ts title="src/posts/posts.e2e.test.ts"
import { Test } from "@blixis-io/testing";
import { describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("write routes require auth", () => {
  it("denies DELETE without a token and allows it with one", async () => {
    const app = await Test.createModule({ imports: [AppModule] }).compile();

    const created = await app.request("/posts", {
      method: "POST",
      json: { title: "to delete" },
      headers: { authorization: "Bearer dev-secret-token" },
    });
    const { id } = (await created.json()) as { id: string };

    const denied = await app.request(`/posts/${id}`, { method: "DELETE" });
    expect(denied.status).toBe(403);

    const allowed = await app.request(`/posts/${id}`, {
      method: "DELETE",
      headers: { authorization: "Bearer dev-secret-token" },
    });
    expect(allowed.status).toBe(204);

    await app.close();
  });
});
```

This builds the *entire real application* — real container, real router, real guard — and asserts on actual HTTP responses. No mocking of the auth mechanism itself; see [Testing](/framework/concepts/testing/) for what `Test.createModule().compile()` is actually doing here.

## Where a real app diverges from this tutorial

Swap `AuthService`'s hardcoded `Set` for a real lookup (a database, a JWT verification call, a call to an identity provider) — nothing else changes, since the guard only ever talks to `AuthService` through its public `verifyToken` method. That's the DI payoff: the guard, the controller, and the module wiring are all already correct for the real implementation; only `AuthService`'s internals need to change.

## Next

- Build a new endpoint test-first, the way this framework's own test suite was built: [Test-Driven API Development](/framework/tutorials/test-driven-api-development/).
