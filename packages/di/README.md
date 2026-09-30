# `@blixis-io/di`

A small, readable dependency injection container — `@Injectable`, `@Inject`, tokens, providers, singleton/transient scopes.

```bash
npm install @blixis-io/di
```

```ts
import { Container, Injectable } from "@blixis-io/di";

@Injectable()
class Database {}

@Injectable()
class UserRepository {
  constructor(public db: Database) {}
}

const container = new Container();
container.register(Database);
container.register(UserRepository);

const repo = await container.resolve(UserRepository);
repo.db; // a Database instance, built automatically
```

Resolves a graph of classes from their constructor parameter types, using nothing but a class decorator and TypeScript's own `emitDecoratorMetadata` output — no `reflect-metadata` call you have to make yourself, no manual registration of "what implements what" beyond registering the provider itself.

Part of [Blixis Framework](https://github.com/blixis-io/framework) — full docs: [Dependency Injection](https://blixis-io.github.io/framework/concepts/dependency-injection/) · [API reference](https://blixis-io.github.io/framework/reference/blixis-di/).
