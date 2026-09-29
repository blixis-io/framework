---
title: Protecting Routes with Guards
description: Write a guard, register it, apply it, and test both the allow and deny paths.
sidebar:
  order: 3
---

See [Guards & Authorization](/concepts/guards-and-authorization/) for the concept; this walks through wiring one up end to end.

## 1. Write the guard

```ts title="src/auth/api-key.guard.ts"
import type { CanActivate, ExecutionContext } from "@blixis/http";
import { Injectable } from "@blixis/di";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return context.request.headers.get("x-api-key") === process.env["API_KEY"];
  }
}
```

## 2. Register it as a provider

Guard classes are resolved through DI at request time — `@UseGuards` alone doesn't register them (see [Guards & Authorization](/concepts/guards-and-authorization/#guard-classes-must-be-registered-providers)):

```ts title="src/posts/posts.module.ts"
@Module({
  providers: [PostService, ApiKeyGuard],
  controllers: [PostController],
})
export class PostsModule {}
```

## 3. Apply it

```ts title="src/posts/posts.controller.ts"
import { UseGuards } from "@blixis/http";
import { ApiKeyGuard } from "../auth/api-key.guard.js";

@Controller("posts")
export class PostController {
  @Get()
  list() { /* open to everyone */ }

  @UseGuards(ApiKeyGuard)
  @Delete(":id")
  remove(@Param("id") id: string) { /* requires the header */ }
}
```

Put `@UseGuards` on the `@Controller()` class itself instead to protect every route in it.

## 4. Test both outcomes

```ts
import { Test } from "@blixis/testing";

it("denies without the key and allows with it", async () => {
  const app = await Test.createModule({ imports: [PostsModule] }).compile();

  const denied = await app.request("/posts/1", { method: "DELETE" });
  expect(denied.status).toBe(403);

  const allowed = await app.request("/posts/1", {
    method: "DELETE",
    headers: { "x-api-key": "dev-secret" },
  });
  expect(allowed.status).toBe(204);

  await app.close();
});
```

## Depending on a service from a guard

Guards are ordinary providers, so constructor injection works exactly the same way — a real auth guard almost always needs one:

```ts
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly users: UserService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const token = context.request.headers.get("authorization");
    return token !== null && (await this.users.verifyToken(token));
  }
}
```

For the full walkthrough building this exact pattern into a real app, see [Add Authentication](/tutorials/add-authentication/).
