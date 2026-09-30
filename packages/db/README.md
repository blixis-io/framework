# `@blixis-io/db`

[Drizzle](https://orm.drizzle.team)-backed Postgres persistence, built on [`@blixis-io/core`](https://www.npmjs.com/package/@blixis-io/core). Connects and disconnects via the same lifecycle hooks as everything else.

```bash
npm install @blixis-io/db @blixis-io/core @blixis-io/di drizzle-orm pg
```

```ts
// db/schema.ts
import { pgTable, serial, text } from "drizzle-orm/pg-core";

export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
});
export const schema = { posts };
```

```ts
// db/index.ts
import { defineDrizzleModule } from "@blixis-io/db";
import { schema } from "./schema.js";

export const { DATABASE, DrizzleModule } = defineDrizzleModule(schema);
```

```ts
@Module({ imports: [DrizzleModule.forRoot({ connection: process.env.DATABASE_URL! })] })
class AppModule {}
```

The connection pool opens on boot (and fails fast with a real error if Postgres isn't reachable) and closes on shutdown, automatically, via the same `OnModuleInit`/`OnApplicationShutdown` lifecycle every other package uses.

Part of [Blixis Framework](https://github.com/blixis-io/framework) — full docs: [Database](https://blixis-io.github.io/framework/concepts/database/) · [API reference](https://blixis-io.github.io/framework/reference/blixis-db/).
