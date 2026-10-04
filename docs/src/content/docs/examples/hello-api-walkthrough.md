---
title: hello-api Walkthrough
description: An annotated tour of the framework's own reference example, examples/hello-api.
sidebar:
  order: 1
---

`examples/hello-api` is the framework's own reference application — a Postgres-backed posts CRUD API used as the end-to-end proof that every package works together. It's the same shape built step by step in [Build Your First API](/framework/tutorials/build-your-first-api/) and [Add Authentication](/framework/tutorials/add-authentication/); this page is a straight tour of the real file layout instead of a build-it-yourself narrative.

```
examples/hello-api/src/
  main.ts
  app.module.ts
  config.ts
  events.ts
  db/
    schema.ts
    index.ts
  health/
    health.controller.ts
  posts/
    post.schema.ts
    posts.service.ts
    posts.controller.ts
    posts.module.ts
    post-activity.ts
    seed.command.ts
    api-key.guard.ts
    timing.interceptor.ts
    posts.e2e.test.ts
```

## `posts/post.schema.ts`

```ts
export const CreatePostSchema = z.object({
  title: z.string().min(1),
  body: z.string().default(""),
});
export type CreatePostInput = z.infer<typeof CreatePostSchema>;

export const UpdatePostSchema = CreatePostSchema.partial();
export type UpdatePostInput = z.infer<typeof UpdatePostSchema>;

export const PostSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type Post = z.infer<typeof PostSchema>;

export const PostListSchema = z.array(PostSchema);
```

The request-side schema/type pair covered in [Validating Request Bodies with Zod](/framework/guides/validating-request-bodies/). `PostSchema` is the same convention applied to the *response* side — `posts.controller.ts` declares it via `@Returns`, so every route's actual output is checked against it on every request, not just assumed correct because `PostsService` is trusted. `PostListSchema` is just `z.array(PostSchema)`, used by the one route (`list`) that returns more than one.

## `db/schema.ts` and `db/index.ts`

```ts title="db/schema.ts"
export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = { posts };
```

```ts title="db/index.ts"
export const { DATABASE, DrizzleModule } = defineDrizzleModule(schema);
export type Database = NodePgDatabase<typeof schema>;
```

A plain `drizzle-orm/pg-core` table plus one call to `@blixis-io/db`'s `defineDrizzleModule` — same factory-closure shape as `@blixis-io/config`'s `defineConfigModule`, for the same reason: the schema is app-specific, so there's no single fixed token to export. See [Database](/framework/concepts/database/).

## `posts/posts.service.ts`

CRUD methods against `DATABASE`, injected via `@Inject(DATABASE)`. `get()` throws `NotFoundException` for a missing id (including a non-numeric one, checked before it ever reaches the database) — `update()` and `remove()` both reuse it instead of repeating the existence check. `update()` resolves each optional field with `??` rather than spreading — see [Validating Request Bodies with Zod](/framework/guides/validating-request-bodies/#3-handle-a-partial-update-correctly) for why that distinction is load-bearing, not stylistic.

`PostsService` also implements `OnModuleInit` to run a `create table if not exists posts (...)` on boot — a stand-in for real migrations until `drizzle-kit` is wired up, fine for this example, not a pattern for a real app.

`remove()` also injects `RequestContext` and reads an `"apiClient"` value back out of it:

```ts
const apiClient = this.ctx.get<string>("apiClient") ?? "unknown";
this.log.info("post deleted", { postId: id, apiClient });
```

That value comes from `ApiKeyGuard`, below — see [Request Context](/framework/concepts/request-context/) for the full picture.

`create()` and `remove()` also emit `post.created` and `post.deleted` on the event bus, after the database write succeeds. See `posts/post-activity.ts` below for who listens.

## `posts/api-key.guard.ts`

```ts
const DEV_API_KEY = "dev-secret";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly ctx: RequestContext) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = context.request.headers.get("x-api-key") === DEV_API_KEY;
    if (allowed) {
      this.ctx.set("apiClient", "dev-cli");
    }
    return allowed;
  }
}
```

A deliberately minimal guard — a hardcoded key comparison, no real credential store. The comment in the actual source is worth repeating here: *"a real CMS auth guard would resolve a `UserService`/config here, which is exactly why guards go through DI instead of `new`."* [Add Authentication](/framework/tutorials/add-authentication/) builds out that fuller version with an injected `AuthService`. The `this.ctx.set("apiClient", "dev-cli")` call is this example's whole `RequestContext` demo: stand-in for "which caller did this," set once here, read back in `posts.service.ts`'s `remove()`.

## `posts/timing.interceptor.ts`

```ts
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

Applied class-level (`@UseInterceptors(TimingInterceptor)` on `PostsController`, below), so it wraps every route in the controller — logs one `"request handled"` line per request with elapsed time, after the handler returns. See [Interceptors](/framework/concepts/interceptors/).

## `posts/posts.controller.ts`

Full CRUD, all five HTTP method decorators in one controller. The one route with `@UseGuards` is `remove` (`DELETE /posts/:id`) — reads and the create/update routes are open, only deletion requires the API key. `create` overrides its status to `201` with `@HttpCode`; `remove` sets `@HttpCode(204)` explicitly (it always returns `undefined`, which already maps to `204` by default — the explicit decorator exists so `@blixis-io/openapi`'s generated document says `204` too, not just the real runtime behavior). `@UseInterceptors(TimingInterceptor)` sits at the class level, above `@Controller`, so it wraps every route — guards still run first and can deny a request before the interceptor ever sees it.

`list`, `get`, `create`, and `update` each carry `@Returns` (`PostListSchema` for `list`, `PostSchema` for the other three) — `remove` doesn't, since it always returns `undefined` and `@Returns` has nothing to check there. See [Response Validation](/framework/concepts/response-validation/).

Every route also carries `@ApiOperation({ summary: "..." })`, and the controller itself `@ApiTags("posts")` (`remove` additionally tags `"admin"`) — purely for [`@blixis-io/openapi`](/framework/concepts/api-documentation/)'s generated document; neither decorator affects routing or runtime behavior at all.

## `events.ts` and `posts/post-activity.ts`

```ts title="events.ts"
export type AppEvents = {
  "post.created": { postId: string; title: string };
  "post.deleted": { postId: string };
};

export const { EventsModule, EVENT_BUS, OnEvent } = defineEventsModule<AppEvents>();
```

```ts title="posts/post-activity.ts"
@Injectable()
export class PostActivity {
  readonly recent: string[] = [];

  constructor(@Inject(LOGGER) private readonly log: Logger) {}

  @OnEvent("post.created")
  created(event: AppEvents["post.created"]): void {
    this.record(`created ${event.postId}: ${event.title}`);
  }

  @OnEvent("post.deleted")
  deleted(event: AppEvents["post.deleted"]): void {
    this.record(`deleted ${event.postId}`);
  }
  // ...
}
```

The listener never touches the bus: `@OnEvent` is typed to `AppEvents`, so a misspelt event name or a wrong payload type fails to compile, and the framework subscribes the methods when the app boots. `PostsService` doesn't know this class exists. It only emits. The activity list is kept in memory to keep the example small; a real app might write an audit table instead. See [Events](/framework/concepts/events/).

## `posts/seed.command.ts`

```ts
@Command({ name: "posts:seed", description: "Create sample posts" })
export class SeedPostsCommand {
  constructor(private readonly posts: PostsService) {}

  async run(@Option("count", { type: "number", default: 3, short: "n" }) count: number): Promise<number> {
    for (let index = 1; index <= count; index++) {
      const post = await this.posts.create({ title: `Sample post ${index}`, body: "" });
      console.log(`created post ${post.id}: ${post.title}`);
    }
    return 0;
  }
}
```

A command is a provider with a `run()` method, so it gets the real `PostsService`: the same code, the same `post.created` event, the same logging as a request. After `pnpm --filter hello-api build`:

```bash
pnpm --filter hello-api exec blix run                  # lists posts:seed
pnpm --filter hello-api exec blix run posts:seed -n 5  # creates five posts
```

`blix run` boots the whole module graph without a socket, including the guards. They inject `RequestContext`, which `blix run` provides (empty, since there is no request). See [Writing Commands](/framework/guides/writing-commands/).

## `posts/posts.module.ts`

```ts
@Module({
  imports: [DrizzleModule.forRoot({ connection: process.env.DATABASE_URL ?? "postgres://blixis:blixis@localhost:5434/blixis" })],
  providers: [PostsService, PostActivity, SeedPostsCommand, ApiKeyGuard, TimingInterceptor],
  controllers: [PostsController],
})
export class PostsModule {}
```

`DrizzleModule.forRoot()` is imported directly here rather than made `global` — only `PostsModule` needs `DATABASE`, so there's no reason to make it visible app-wide. `ApiKeyGuard` and `TimingInterceptor` are both listed in `providers` even though no controller method injects either directly — they're resolved by the HTTP layer at request time because `@UseGuards`/`@UseInterceptors` named the classes, not because anything constructor-injects them. Leaving either out of `providers` is the single most common mistake when adding a guard or interceptor — see [Guards & Authorization](/framework/concepts/guards-and-authorization/#guard-classes-must-be-registered-providers).

## `health/health.controller.ts`

```ts
import { Controller, Get } from "@blixis-io/http";

@Controller("health")
export class HealthController {
  @Get()
  check() {
    return { status: "ok" };
  }
}
```

Generated with `blix generate controller health` (`@blixis-io/cli`), then hand-edited — the generator produces a valid starting point (originally a `list()` method returning `[]`), not a finished route; the real handler and its name are still yours to write. See [Code Generation](/framework/concepts/code-generation/). No dedicated module for this one, unlike `posts/` — a single provider-less route isn't worth its own module, so it's listed directly in `AppModule`'s own `controllers` array below.

## `config.ts`, `app.module.ts`, and `main.ts`

```ts title="config.ts"
export const AppConfigSchema = z.object({
  PORT: z.coerce.number().default(3000),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const { CONFIG, ConfigModule } = defineConfigModule(AppConfigSchema);
```

```ts title="app.module.ts"
@Module({
  imports: [
    ConfigModule.forRoot(),
    LoggerModule.forRoot({ transports: [consoleTransport()] }),
    EventsModule.forRoot({ global: true }),
    PostsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
```

`EventsModule.forRoot({ global: true })` makes the bus injectable everywhere without each module importing it. `ConfigModule` and `LoggerModule` are both `global: true` internally, so every module — including `PostsModule` and its own `DrizzleModule` import — can inject `CONFIG`/`LOGGER` without importing either directly. See [Configuration](/framework/concepts/config/) and [Logging](/framework/concepts/logging/). `HealthController` is listed directly in `controllers` rather than getting its own module — a root module can own controllers itself, exactly like any other module can (see `@Module`'s `ModuleMetadata` in the [`@blixis-io/core` reference](/framework/reference/blixis-core/)).

```ts title="main.ts"
const app = await createHttpApplication(AppModule);
serveOpenApi(app, "/openapi.json", {
  title: "hello-api",
  version: "1.0.0",
  description: "The framework's own reference example — a Postgres-backed posts CRUD API.",
});

const { PORT } = app.get(CONFIG);
await app.listen(PORT);

const log = app.get(LOGGER);
log.info("hello-api listening", { port: PORT });

process.on("SIGTERM", () => {
  log.info("received SIGTERM, shutting down");
  void app.close("SIGTERM").then(() => process.exit(0));
});
```

`serveOpenApi` publishes the generated OpenAPI document at `GET /openapi.json` in one call, built on first request. The route is public (it bypasses guards); see [Generating API Docs](/framework/guides/generating-api-docs/) for the guarded alternative.

The `SIGTERM` handler is the whole graceful-shutdown story — see [Running in Production](/framework/guides/running-in-production/) for what `close()` actually does (closes the socket, runs every `OnApplicationShutdown` hook — including `DrizzleModule`'s pool `.end()` — and is safe to call more than once).

## `posts/posts.e2e.test.ts`

Ten tests, all through `Test.createModule({ imports: [..., EventsModule.forRoot({ global: true }), PostsModule] }).compile()` and `app.request(...)` — no mocking, a real application built fresh per test, against the same real Postgres the app itself uses. `createTestApp()` deletes every row from `posts` right after compiling, so each test starts from an empty table even though the database itself persists across tests. They cover: create + list, a Zod validation failure (`400` with issues), a missing post (`404`), the wrong method on a known path (`405` with `Allow`), the guard denying and then allowing a `DELETE`, a `PATCH` partial update, the `@OnEvent` listener seeing a create and a delete (and nothing for a rejected request), and `posts:seed` run through `runCommand` (including a non-numeric `--count` failing with exit code `1`). This is the pattern [Test-Driven API Development](/framework/tutorials/test-driven-api-development/) walks through building from scratch.

## Running it yourself

Start Postgres once, from the repo root:

```bash
docker compose up -d
```

Then build and run the app:

```bash
pnpm --filter hello-api run build
pnpm --filter hello-api run start
```

Then exercise it with `curl` — see the command list in [Build Your First API](/framework/tutorials/build-your-first-api/#6-try-every-route), which matches this example's routes exactly. `curl localhost:3000/openapi.json` returns the live generated OpenAPI document — see [Generating API Docs](/framework/guides/generating-api-docs/) for pointing a UI at it. `curl localhost:3000/health` returns `{"status":"ok"}` — the route generated by `blix` above.
