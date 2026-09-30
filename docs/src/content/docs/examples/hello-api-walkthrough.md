---
title: hello-api Walkthrough
description: An annotated tour of the framework's own reference example, examples/hello-api.
sidebar:
  order: 1
---

`examples/hello-api` is the framework's own reference application — a Postgres-backed posts CRUD API used as the end-to-end proof that every package works together. It's the same shape built step by step in [Build Your First API](/tutorials/build-your-first-api/) and [Add Authentication](/tutorials/add-authentication/); this page is a straight tour of the real file layout instead of a build-it-yourself narrative.

```
examples/hello-api/src/
  main.ts
  app.module.ts
  config.ts
  db/
    schema.ts
    index.ts
  posts/
    post.schema.ts
    posts.service.ts
    posts.controller.ts
    posts.module.ts
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

The request-side schema/type pair covered in [Validating Request Bodies with Zod](/guides/validating-request-bodies/). `PostSchema` is the same convention applied to the *response* side — `posts.controller.ts` declares it via `@Returns`, so every route's actual output is checked against it on every request, not just assumed correct because `PostsService` is trusted. `PostListSchema` is just `z.array(PostSchema)`, used by the one route (`list`) that returns more than one.

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

A plain `drizzle-orm/pg-core` table plus one call to `@blixis/db`'s `defineDrizzleModule` — same factory-closure shape as `@blixis/config`'s `defineConfigModule`, for the same reason: the schema is app-specific, so there's no single fixed token to export. See [Database](/concepts/database/).

## `posts/posts.service.ts`

CRUD methods against `DATABASE`, injected via `@Inject(DATABASE)`. `get()` throws `NotFoundException` for a missing id (including a non-numeric one, checked before it ever reaches the database) — `update()` and `remove()` both reuse it instead of repeating the existence check. `update()` resolves each optional field with `??` rather than spreading — see [Validating Request Bodies with Zod](/guides/validating-request-bodies/#3-handle-a-partial-update-correctly) for why that distinction is load-bearing, not stylistic.

`PostsService` also implements `OnModuleInit` to run a `create table if not exists posts (...)` on boot — a stand-in for real migrations until `drizzle-kit` is wired up, fine for this example, not a pattern for a real app.

`remove()` also injects `RequestContext` and reads an `"apiClient"` value back out of it:

```ts
const apiClient = this.ctx.get<string>("apiClient") ?? "unknown";
this.log.info("post deleted", { postId: id, apiClient });
```

That value comes from `ApiKeyGuard`, below — see [Request Context](/concepts/request-context/) for the full picture.

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

A deliberately minimal guard — a hardcoded key comparison, no real credential store. The comment in the actual source is worth repeating here: *"a real CMS auth guard would resolve a `UserService`/config here, which is exactly why guards go through DI instead of `new`."* [Add Authentication](/tutorials/add-authentication/) builds out that fuller version with an injected `AuthService`. The `this.ctx.set("apiClient", "dev-cli")` call is this example's whole `RequestContext` demo: stand-in for "which caller did this," set once here, read back in `posts.service.ts`'s `remove()`.

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

Applied class-level (`@UseInterceptors(TimingInterceptor)` on `PostsController`, below), so it wraps every route in the controller — logs one `"request handled"` line per request with elapsed time, after the handler returns. See [Interceptors](/concepts/interceptors/).

## `posts/posts.controller.ts`

Full CRUD, all five HTTP method decorators in one controller. The one route with `@UseGuards` is `remove` (`DELETE /posts/:id`) — reads and the create/update routes are open, only deletion requires the API key. `create` overrides its status to `201` with `@HttpCode`; `remove` returns `undefined`, mapped to `204 No Content`. `@UseInterceptors(TimingInterceptor)` sits at the class level, above `@Controller`, so it wraps every route — guards still run first and can deny a request before the interceptor ever sees it.

`list`, `get`, `create`, and `update` each carry `@Returns` (`PostListSchema` for `list`, `PostSchema` for the other three) — `remove` doesn't, since it always returns `undefined` and `@Returns` has nothing to check there. See [Response Validation](/concepts/response-validation/).

## `posts/posts.module.ts`

```ts
@Module({
  imports: [DrizzleModule.forRoot({ connection: process.env.DATABASE_URL ?? "postgres://blixis:blixis@localhost:5434/blixis" })],
  providers: [PostsService, ApiKeyGuard, TimingInterceptor],
  controllers: [PostsController],
})
export class PostsModule {}
```

`DrizzleModule.forRoot()` is imported directly here rather than made `global` — only `PostsModule` needs `DATABASE`, so there's no reason to make it visible app-wide. `ApiKeyGuard` and `TimingInterceptor` are both listed in `providers` even though no controller method injects either directly — they're resolved by the HTTP layer at request time because `@UseGuards`/`@UseInterceptors` named the classes, not because anything constructor-injects them. Leaving either out of `providers` is the single most common mistake when adding a guard or interceptor — see [Guards & Authorization](/concepts/guards-and-authorization/#guard-classes-must-be-registered-providers).

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
    PostsModule,
  ],
})
export class AppModule {}
```

`ConfigModule` and `LoggerModule` are both `global: true` internally, so every module — including `PostsModule` and its own `DrizzleModule` import — can inject `CONFIG`/`LOGGER` without importing either directly. See [Configuration](/concepts/config/) and [Logging](/concepts/logging/).

```ts title="main.ts"
const app = await createHttpApplication(AppModule);

const { PORT } = app.get(CONFIG);
await app.listen(PORT);

const log = app.get(LOGGER);
log.info("hello-api listening", { port: PORT });

process.on("SIGTERM", () => {
  log.info("received SIGTERM, shutting down");
  void app.close("SIGTERM").then(() => process.exit(0));
});
```

The `SIGTERM` handler is the whole graceful-shutdown story — see [Running in Production](/guides/running-in-production/) for what `close()` actually does (closes the socket, runs every `OnApplicationShutdown` hook — including `DrizzleModule`'s pool `.end()` — and is safe to call more than once).

## `posts/posts.e2e.test.ts`

Six tests, all through `Test.createModule({ imports: [PostsModule] }).compile()` and `app.request(...)` — no mocking, a real application built fresh per test, against the same real Postgres the app itself uses. `createTestApp()` deletes every row from `posts` right after compiling, so each test starts from an empty table even though the database itself persists across tests. They cover: create + list, a Zod validation failure (`400` with issues), a missing post (`404`), the wrong method on a known path (`405` with `Allow`), the guard denying and then allowing a `DELETE`, and a `PATCH` partial update. This is the pattern [Test-Driven API Development](/tutorials/test-driven-api-development/) walks through building from scratch.

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

Then exercise it with `curl` — see the command list in [Build Your First API](/tutorials/build-your-first-api/#6-try-every-route), which matches this example's routes exactly.
