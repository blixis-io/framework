# `@blixis-io/core`

The module system built on [`@blixis-io/di`](https://www.npmjs.com/package/@blixis-io/di) — `@Module`, lifecycle hooks, application bootstrapping.

```bash
npm install @blixis-io/core @blixis-io/di
```

```ts
import { Module, createApplication } from "@blixis-io/core";

@Module({
  imports: [DatabaseModule],
  providers: [PostService, PostRepository],
  controllers: [PostController],
})
export class PostsModule {}

const app = await createApplication(PostsModule);
app.get(PostService); // an already-resolved singleton
await app.close();    // runs OnApplicationShutdown hooks, in reverse dependency order
```

`createApplication` walks the import graph, flattens every module's providers and controllers into one container, resolves everything eagerly, and runs `OnModuleInit` hooks in dependency order.

Part of [Blixis Framework](https://github.com/blixis-io/framework) — full docs: [Modules](https://blixis-io.github.io/framework/concepts/modules/) · [Lifecycle Hooks](https://blixis-io.github.io/framework/concepts/lifecycle-hooks/) · [API reference](https://blixis-io.github.io/framework/reference/blixis-core/).
