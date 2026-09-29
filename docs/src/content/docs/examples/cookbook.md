---
title: Cookbook
description: Short, standalone recipes for patterns that come up but don't need a full guide.
sidebar:
  order: 2
---

## Returning a raw `Response`

A controller method can return a `Response` directly instead of a plain value — it passes through completely unchanged, no JSON-wrapping, no status override from `@HttpCode`:

```ts
@Get("robots.txt")
robots() {
  return new Response("User-agent: *\nDisallow:", {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}
```

Useful for anything that isn't JSON — plain text, a redirect (`Response.redirect(url, 302)`), or a response with headers the default JSON path doesn't set.

## A factory provider that depends on other providers

```ts
const APP_CONFIG = new InjectionToken<{ port: number }>("app.config");

@Module({
  providers: [
    EnvService,
    {
      provide: APP_CONFIG,
      useFactory: (env: EnvService) => ({ port: env.getNumber("PORT", 3000) }),
      inject: [EnvService],
    },
  ],
})
class ConfigModule {}
```

`inject` lists the factory's own parameters, resolved the same way constructor parameters are — the factory itself can be `async`.

## Aliasing a token to an existing provider (`useExisting`)

```ts
@Injectable()
class ConcreteLogger {}

const LOGGER_ALIAS = new InjectionToken<ConcreteLogger>("logger.alias");

container.register(ConcreteLogger);
container.register({ provide: LOGGER_ALIAS, useExisting: ConcreteLogger });
```

Resolving `LOGGER_ALIAS` returns the *exact same instance* as resolving `ConcreteLogger` directly — useful for giving one concrete provider a second, more abstract name without duplicating its construction.

## A wildcard "catch-all" route

```ts
@Controller("assets")
class AssetController {
  @Get("*")
  serve(@Param("*") path: string) {
    // path is everything after /assets/ — e.g. "img/logo.png"
    return serveStaticFile(path);
  }
}
```

`*` must be the last path segment, and it captures the *entire* remainder of the path as one string, joined with `/` — not just one segment, unlike `:param`. See [Routing & Controllers](/concepts/routing-controllers/#how-a-request-is-matched) for how this interacts with static and param routes on the same prefix.

## Reading all headers at once

```ts
@Get()
debug(@Headers() headers: Record<string, string>) {
  return headers;
}
```

`@Headers()` with no argument returns every header as a plain object; `@Headers("x-request-id")` returns just that one value (or `null` if absent).

## A guard that reads route params, not just the request

```ts
@Injectable()
class OwnerGuard implements CanActivate {
  constructor(private readonly posts: PostsService) {}

  async canActivate({ request, params }: ExecutionContext): Promise<boolean> {
    const post = this.posts.get(params["id"]!);
    const userId = request.headers.get("x-user-id");
    return post.authorId === userId;
  }
}
```

`ExecutionContext.params` is the same matched route params (`{ id: "42" }` for `/posts/:id`) that `@Param` pulls from — a guard sees them without needing its own copy of the routing logic.
