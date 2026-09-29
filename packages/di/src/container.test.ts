import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { Container } from "./container.js";
import { Inject, Injectable, Optional } from "./decorators.js";
import {
  CircularDependencyError,
  DuplicateProviderError,
  MissingProviderError,
  NotInjectableError,
  ProviderNotResolvedError,
  UnresolvableParameterError,
} from "./errors.js";
import { forwardRef } from "./forward-ref.js";
import { InjectionToken } from "./tokens.js";

describe("Container: instantiation and scope", () => {
  it("resolves a singleton to the same instance across calls", async () => {
    @Injectable()
    class Service {}
    const container = new Container();
    container.register(Service);

    const a = await container.resolve(Service);
    const b = await container.resolve(Service);

    expect(a).toBeInstanceOf(Service);
    expect(a).toBe(b);
  });

  it("resolves a transient provider to a new instance every time", async () => {
    @Injectable({ scope: "transient" })
    class Service {}
    const container = new Container();
    container.register(Service);

    const a = await container.resolve(Service);
    const b = await container.resolve(Service);

    expect(a).not.toBe(b);
  });
});

describe("Container: constructor injection", () => {
  it("injects constructor dependencies via reflected types, three levels deep", async () => {
    @Injectable()
    class Database {}

    @Injectable()
    class Repository {
      constructor(public db: Database) {}
    }

    @Injectable()
    class Service {
      constructor(public repo: Repository) {}
    }

    const container = new Container();
    container.register(Database);
    container.register(Repository);
    container.register(Service);

    const service = await container.resolve(Service);

    expect(service.repo).toBeInstanceOf(Repository);
    expect(service.repo.db).toBeInstanceOf(Database);
  });

  it("resolves a shared singleton dependency to one instance for two sibling constructor params", async () => {
    @Injectable()
    class Shared {}

    @Injectable()
    class Left {
      constructor(public shared: Shared) {}
    }

    @Injectable()
    class Right {
      constructor(public shared: Shared) {}
    }

    @Injectable()
    class Root {
      constructor(
        public left: Left,
        public right: Right,
      ) {}
    }

    const container = new Container();
    container.register(Shared);
    container.register(Left);
    container.register(Right);
    container.register(Root);

    const root = await container.resolve(Root);

    expect(root.left.shared).toBe(root.right.shared);
  });
});

describe("Container: @Inject overrides", () => {
  it("overrides the reflected parameter type with an InjectionToken", async () => {
    interface Config {
      name: string;
    }
    const CONFIG = new InjectionToken<Config>("config");

    @Injectable()
    class Service {
      constructor(@Inject(CONFIG) public config: Config) {}
    }

    const container = new Container();
    container.register({ provide: CONFIG, useValue: { name: "blixis" } });
    container.register(Service);

    const service = await container.resolve(Service);

    expect(service.config).toEqual({ name: "blixis" });
  });
});

describe("Container: provider kinds", () => {
  it("useValue registers a plain value", async () => {
    const TOKEN = new InjectionToken<number>("count");
    const container = new Container();
    container.register({ provide: TOKEN, useValue: 42 });

    expect(await container.resolve(TOKEN)).toBe(42);
  });

  it("useClass binds a token to a different implementation class", async () => {
    abstract class Logger {}

    @Injectable()
    class ConsoleLogger extends Logger {}

    const container = new Container();
    container.register({ provide: Logger, useClass: ConsoleLogger });

    expect(await container.resolve(Logger)).toBeInstanceOf(ConsoleLogger);
  });

  it("useClass defaults to singleton scope when the implementation has no @Injectable() at all", async () => {
    abstract class Logger {}
    class UndecoratedLogger extends Logger {}

    const container = new Container();
    container.register({ provide: Logger, useClass: UndecoratedLogger });

    const a = await container.resolve(Logger);
    const b = await container.resolve(Logger);

    expect(a).toBe(b);
  });

  it("useExisting aliases another token and shares its instance", async () => {
    @Injectable()
    class ConcreteLogger {}
    const ALIAS = new InjectionToken<ConcreteLogger>("logger-alias");

    const container = new Container();
    container.register(ConcreteLogger);
    container.register({ provide: ALIAS, useExisting: ConcreteLogger });

    const original = await container.resolve(ConcreteLogger);
    const aliased = await container.resolve(ALIAS);

    expect(aliased).toBe(original);
  });

  it("useFactory builds a value from injected dependencies", async () => {
    @Injectable()
    class Config {
      port = 3000;
    }
    const PORT = new InjectionToken<number>("port");

    const container = new Container();
    container.register(Config);
    container.register({
      provide: PORT,
      useFactory: (config: Config) => config.port,
      inject: [Config],
    });

    expect(await container.resolve(PORT)).toBe(3000);
  });

  it("useFactory supports async factories", async () => {
    const TOKEN = new InjectionToken<string>("async-value");
    const container = new Container();
    container.register({ provide: TOKEN, useFactory: async () => "ready" });

    expect(await container.resolve(TOKEN)).toBe("ready");
  });
});

describe("Container: @Optional", () => {
  it("resolves to undefined when no provider is registered for an optional dependency", async () => {
    @Injectable()
    class MissingDep {}

    @Injectable()
    class Service {
      constructor(@Optional() public dep?: MissingDep) {}
    }

    const container = new Container();
    container.register(Service);

    const service = await container.resolve(Service);

    expect(service.dep).toBeUndefined();
  });
});

describe("Container: errors", () => {
  it("throws MissingProviderError with the full resolution chain", async () => {
    @Injectable()
    class Database {}

    @Injectable()
    class PostService {
      constructor(public db: Database) {}
    }

    @Injectable()
    class PostController {
      constructor(public service: PostService) {}
    }

    const container = new Container();
    container.register(PostService);
    container.register(PostController);

    await expect(container.resolve(PostController)).rejects.toThrow(MissingProviderError);
    await expect(container.resolve(PostController)).rejects.toThrow(
      'No provider for "Database" (resolution path: PostController -> PostService -> Database)',
    );
  });

  it("throws MissingProviderError with a one-element chain when resolving an unregistered token directly", async () => {
    const TOKEN = new InjectionToken<string>("missing");
    const container = new Container();

    await expect(container.resolve(TOKEN)).rejects.toThrow('No provider for "InjectionToken(missing)"');
  });

  it("throws CircularDependencyError with the cycle path", async () => {
    @Injectable()
    class A {
      constructor(@Inject(forwardRef(() => B)) public b: unknown) {}
    }

    @Injectable()
    class B {
      constructor(public a: A) {}
    }

    const container = new Container();
    container.register(A);
    container.register(B);

    await expect(container.resolve(A)).rejects.toThrow(CircularDependencyError);
    await expect(container.resolve(A)).rejects.toThrow("Circular dependency detected: A -> B -> A");
  });

  it("throws UnresolvableParameterError when the reflected type is Object", async () => {
    interface Dep {
      name: string;
    }

    @Injectable()
    class Service {
      constructor(public dep: Dep) {}
    }

    const container = new Container();
    container.register(Service);

    await expect(container.resolve(Service)).rejects.toThrow(UnresolvableParameterError);
    await expect(container.resolve(Service)).rejects.toThrow(
      "Parameter #0 of Service is Object — add @Inject(token) or import the class as a value.",
    );
  });

  it("throws UnresolvableParameterError when the reflected type is literally undefined (e.g. a `void`-typed param)", async () => {
    @Injectable()
    class Service {
      // `void` is the one annotation TS reflects as a literal `undefined`
      // paramtype rather than falling back to `Object`. The constructor's
      // sole purpose is carrying that param for reflection to see.
      // oxlint-disable-next-line no-useless-constructor
      constructor(_x: void) {}
    }

    const container = new Container();
    container.register(Service);

    await expect(container.resolve(Service)).rejects.toThrow(
      "Parameter #0 of Service is undefined — add @Inject(token) or import the class as a value.",
    );
  });

  it("throws NotInjectableError when a class with constructor params has no @Injectable decorator", async () => {
    class Dep {}
    class Service {
      constructor(public dep: Dep) {}
    }

    const container = new Container();
    container.register(Service);

    await expect(container.resolve(Service)).rejects.toThrow(NotInjectableError);
  });

  it("throws DuplicateProviderError when the same token is registered twice", () => {
    @Injectable()
    class Service {}
    const container = new Container();
    container.register(Service);

    expect(() => container.register(Service)).toThrow(DuplicateProviderError);
  });
});

describe("Container: forwardRef", () => {
  it("resolves a forward-referenced dependency once both classes exist", async () => {
    // The param type is deliberately `unknown`, not `Dep`: TS evaluates a
    // `design:paramtypes` type reference eagerly, at class-decoration time,
    // so typing it `Dep` here would throw a TDZ ReferenceError regardless
    // of forwardRef — this is the same reason `@Inject`'s override exists,
    // to bypass paramtypes entirely for a not-yet-declared dependency.
    @Injectable()
    class Service {
      constructor(@Inject(forwardRef(() => Dep)) public dep: unknown) {}
    }

    @Injectable()
    class Dep {}

    const container = new Container();
    container.register(Dep);
    container.register(Service);

    const service = await container.resolve(Service);

    expect(service.dep).toBeInstanceOf(Dep);
  });
});

describe("Container: get()", () => {
  it("throws ProviderNotResolvedError before resolve(), then returns the cached value after", async () => {
    const TOKEN = new InjectionToken<string>("async-token");
    const container = new Container();
    container.register({ provide: TOKEN, useFactory: async () => "value" });

    expect(() => container.get(TOKEN)).toThrow(ProviderNotResolvedError);

    await container.resolve(TOKEN);

    expect(container.get(TOKEN)).toBe("value");
  });
});

describe("Container: resolveAll", () => {
  it("resolves every registered provider", async () => {
    @Injectable()
    class A {}
    @Injectable()
    class B {}

    const container = new Container();
    container.register(A);
    container.register(B);

    await container.resolveAll();

    expect(container.get(A)).toBeInstanceOf(A);
    expect(container.get(B)).toBeInstanceOf(B);
  });
});

describe("Container: getResolvedEntries", () => {
  it("lists resolved singletons in dependency-construction order (deps before dependents)", async () => {
    @Injectable()
    class Database {}
    @Injectable()
    class Repository {
      constructor(public db: Database) {}
    }
    @Injectable()
    class Service {
      constructor(public repo: Repository) {}
    }

    const container = new Container();
    // Registered in an order that does NOT match dependency order, to
    // prove the returned order tracks actual construction, not registration.
    container.register(Service);
    container.register(Repository);
    container.register(Database);

    await container.resolve(Service);

    const order = container.getResolvedEntries().map(([token]) => token);
    expect(order).toEqual([Database, Repository, Service]);
  });

  it("excludes transient providers, which are never cached", async () => {
    @Injectable({ scope: "transient" })
    class Transient {}
    @Injectable()
    class Singleton {}

    const container = new Container();
    container.register(Transient);
    container.register(Singleton);

    await container.resolve(Transient);
    await container.resolve(Singleton);

    const tokens = container.getResolvedEntries().map(([token]) => token);
    expect(tokens).toEqual([Singleton]);
  });
});
