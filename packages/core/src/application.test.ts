import { DuplicateProviderError, Inject, Injectable, InjectionToken, Optional } from "@blixis-io/di";
import { describe, expect, it, vi } from "vitest";
import { createApplication } from "./application.js";
import type { BootstrapContext } from "./lifecycle.js";
import { NotAModuleError, ProviderNotVisibleError } from "./errors.js";
import { Module } from "./module.js";

describe("createApplication: flat module", () => {
  it("resolves providers declared directly on the root module", async () => {
    @Injectable()
    class Service {
      greet(): string {
        return "hi";
      }
    }

    @Module({ providers: [Service] })
    class AppModule {}

    const app = await createApplication(AppModule);

    expect(app.get(Service).greet()).toBe("hi");
  });
});

describe("createApplication: nested imports", () => {
  it("resolves providers from an imported module", async () => {
    @Injectable()
    class Repo {}

    @Module({ providers: [Repo] })
    class DataModule {}

    @Module({ imports: [DataModule] })
    class AppModule {}

    const app = await createApplication(AppModule);

    expect(app.get(Repo)).toBeInstanceOf(Repo);
  });
});

describe("createApplication: diamond imports", () => {
  it("imports the same module through two paths without registering its providers twice", async () => {
    @Injectable()
    class Shared {}

    @Module({ providers: [Shared] })
    class SharedModule {}

    @Module({ imports: [SharedModule] })
    class FeatureA {}

    @Module({ imports: [SharedModule] })
    class FeatureB {}

    @Module({ imports: [FeatureA, FeatureB] })
    class AppModule {}

    const app = await createApplication(AppModule);

    expect(app.get(Shared)).toBeInstanceOf(Shared);
  });
});

describe("createApplication: dynamic modules", () => {
  it("merges a dynamic module's extra providers with its static @Module() metadata", async () => {
    const CONFIG = new InjectionToken<{ name: string }>("config");

    @Module()
    class ConfigModule {
      static forRoot(config: { name: string }) {
        return { module: ConfigModule, providers: [{ provide: CONFIG, useValue: config }] };
      }
    }

    @Module({ imports: [ConfigModule.forRoot({ name: "blixis" })] })
    class AppModule {}

    const app = await createApplication(AppModule);

    expect(app.get(CONFIG)).toEqual({ name: "blixis" });
  });

  it("lets one module class be registered several times, each registration keeping its own providers", async () => {
    const PRIMARY = new InjectionToken<string>("primary-db");
    const AUDIT = new InjectionToken<string>("audit-db");

    @Module()
    class DatabaseModule {
      static forRoot(token: InjectionToken<string>, url: string) {
        return { module: DatabaseModule, providers: [{ provide: token, useValue: url }], exports: [token] };
      }
    }

    @Injectable()
    class Repo {
      constructor(
        @Inject(PRIMARY) readonly primary: string,
        @Inject(AUDIT) readonly audit: string,
      ) {}
    }

    @Module({
      imports: [DatabaseModule.forRoot(PRIMARY, "pg://primary"), DatabaseModule.forRoot(AUDIT, "pg://audit")],
      providers: [Repo],
    })
    class AppModule {}

    const app = await createApplication(AppModule);

    expect(app.get(Repo)).toMatchObject({ primary: "pg://primary", audit: "pg://audit" });
  });

  it("registers the class's static providers once, however many times the module is registered", async () => {
    const A = new InjectionToken<string>("a");
    const B = new InjectionToken<string>("b");

    @Injectable()
    class Shared {}

    @Module({ providers: [Shared], exports: [Shared] })
    class PoolModule {
      static forRoot(token: InjectionToken<string>) {
        return { module: PoolModule, providers: [{ provide: token, useValue: "x" }] };
      }
    }

    @Module({ imports: [PoolModule.forRoot(A), PoolModule.forRoot(B)] })
    class AppModule {}

    const app = await createApplication(AppModule);

    expect(app.get(Shared)).toBeInstanceOf(Shared);
    expect(app.get(A)).toBe("x");
    expect(app.get(B)).toBe("x");
  });

  it("lets a registration's own providers depend on the class's static providers", async () => {
    @Injectable()
    class Pool {}

    @Injectable()
    class Client {
      constructor(readonly pool: Pool) {}
    }

    const A = new InjectionToken<Client>("a");
    const B = new InjectionToken<Client>("b");

    @Module({ providers: [Pool] })
    class DbModule {
      static forRoot(token: InjectionToken<Client>) {
        return { module: DbModule, providers: [{ provide: token, useClass: Client }] };
      }
    }

    @Module({ imports: [DbModule.forRoot(A), DbModule.forRoot(B)] })
    class AppModule {}

    const app = await createApplication(AppModule);

    expect(app.get(A)).toBeInstanceOf(Client);
    expect(app.get(B)).toBeInstanceOf(Client);
  });

  it("throws DuplicateProviderError when two registrations provide the same token", async () => {
    const DB = new InjectionToken<string>("db");

    @Module()
    class DatabaseModule {
      static forRoot(url: string) {
        return { module: DatabaseModule, providers: [{ provide: DB, useValue: url }] };
      }
    }

    @Module({ imports: [DatabaseModule.forRoot("primary"), DatabaseModule.forRoot("audit")] })
    class AppModule {}

    await expect(createApplication(AppModule)).rejects.toThrow(DuplicateProviderError);
  });

  it("dedupes the same dynamic registration reached through several imports", async () => {
    const CONFIG = new InjectionToken<string>("config");

    @Module()
    class ConfigModule {
      static forRoot(value: string) {
        return { module: ConfigModule, providers: [{ provide: CONFIG, useValue: value }] };
      }
    }

    const config = ConfigModule.forRoot("shared");

    @Module({ imports: [config] })
    class AModule {}

    @Module({ imports: [config, AModule] })
    class AppModule {}

    const app = await createApplication(AppModule);

    expect(app.get(CONFIG)).toBe("shared");
  });
});

describe("createApplication: lifecycle hooks", () => {
  it("runs onModuleInit in dependency order (deps before dependents)", async () => {
    const calls: string[] = [];

    @Injectable()
    class Database {
      onModuleInit(): void {
        calls.push("Database");
      }
    }

    @Injectable()
    class Repo {
      constructor(@Inject(Database) public db: Database) {}
      onModuleInit(): void {
        calls.push("Repo");
      }
    }

    @Module({ providers: [Database, Repo] })
    class AppModule {}

    await createApplication(AppModule);

    expect(calls).toEqual(["Database", "Repo"]);
  });

  it("runs onApplicationShutdown in reverse dependency order", async () => {
    const calls: string[] = [];

    @Injectable()
    class Database {
      onApplicationShutdown(): void {
        calls.push("Database");
      }
    }

    @Injectable()
    class Repo {
      constructor(@Inject(Database) public db: Database) {}
      onApplicationShutdown(): void {
        calls.push("Repo");
      }
    }

    @Module({ providers: [Database, Repo] })
    class AppModule {}

    const app = await createApplication(AppModule);
    await app.close();

    expect(calls).toEqual(["Repo", "Database"]);
  });

  it("close() is idempotent: a second call does not re-run shutdown hooks", async () => {
    const calls: string[] = [];

    @Injectable()
    class Service {
      onApplicationShutdown(): void {
        calls.push("Service");
      }
    }

    @Module({ providers: [Service] })
    class AppModule {}

    const app = await createApplication(AppModule);
    await app.close();
    await app.close();

    expect(calls).toEqual(["Service"]);
  });
});

function constructorName(instance: unknown): string {
  return typeof instance === "object" && instance !== null ? instance.constructor.name : String(instance);
}

describe("createApplication: onApplicationBootstrap and resolved()", () => {
  it("runs after EVERY onModuleInit has finished, not interleaved with them", async () => {
    const calls: string[] = [];

    @Injectable()
    class Database {
      onModuleInit(): void {
        calls.push("init:Database");
      }
    }

    @Injectable()
    class Discoverer {
      constructor(@Inject(Database) readonly db: Database) {}
      onModuleInit(): void {
        calls.push("init:Discoverer");
      }
      onApplicationBootstrap(): void {
        calls.push("bootstrap:Discoverer");
      }
    }

    @Injectable()
    class Late {
      onModuleInit(): void {
        calls.push("init:Late");
      }
    }

    @Module({ providers: [Database, Discoverer, Late] })
    class AppModule {}

    await createApplication(AppModule);

    expect(calls.at(-1)).toBe("bootstrap:Discoverer");
    expect(calls.indexOf("bootstrap:Discoverer")).toBeGreaterThan(calls.indexOf("init:Late"));
  });

  it("hands the hook an application whose resolved() lists every provider instance", async () => {
    @Injectable()
    class Alpha {}

    @Injectable()
    class Beta {}

    let seen: string[] = [];

    @Injectable()
    class Scanner {
      onApplicationBootstrap(app: BootstrapContext): void {
        seen = app.resolved().map(([, instance]) => constructorName(instance));
      }
    }

    @Module({ providers: [Alpha, Beta, Scanner] })
    class AppModule {}

    await createApplication(AppModule);

    expect(seen).toEqual(expect.arrayContaining(["Alpha", "Beta", "Scanner"]));
  });

  it("lets the hook use get() to reach other providers", async () => {
    const TOKEN = new InjectionToken<string>("greeting");
    let greeting = "";

    @Injectable()
    class Reader {
      onApplicationBootstrap(app: BootstrapContext): void {
        greeting = app.get(TOKEN);
      }
    }

    @Module({ providers: [{ provide: TOKEN, useValue: "hello" }, Reader] })
    class AppModule {}

    await createApplication(AppModule);

    expect(greeting).toBe("hello");
  });

  it("awaits an async hook, and fails boot if it throws", async () => {
    @Injectable()
    class Slow {
      static done = false;
      async onApplicationBootstrap(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 10));
        Slow.done = true;
      }
    }

    @Module({ providers: [Slow] })
    class SlowModule {}

    await createApplication(SlowModule);
    expect(Slow.done).toBe(true);

    @Injectable()
    class Broken {
      onApplicationBootstrap(): void {
        throw new Error("bootstrap failed");
      }
    }

    @Module({ providers: [Broken] })
    class BrokenModule {}

    await expect(createApplication(BrokenModule)).rejects.toThrow("bootstrap failed");
  });

  it("Application.resolved() is available after boot, and has no transient providers", async () => {
    @Injectable()
    class Single {}

    @Injectable({ scope: "transient" })
    class Fresh {}

    @Module({ providers: [Single, Fresh] })
    class AppModule {}

    const app = await createApplication(AppModule);
    const names = app.resolved().map(([, instance]) => constructorName(instance));

    expect(names).toContain("Single");
    expect(names).not.toContain("Fresh");
  });
});

describe("createApplication: controllers", () => {
  it("registers controllers as resolvable providers and lists them on the app", async () => {
    @Injectable()
    class PostController {}

    @Module({ controllers: [PostController] })
    class AppModule {}

    const app = await createApplication(AppModule);

    expect(app.controllers).toEqual([PostController]);
    expect(app.get(PostController)).toBeInstanceOf(PostController);
  });
});

describe("createApplication: overrides", () => {
  it("replaces a provider from the module graph before resolution", async () => {
    @Injectable()
    class RealRepo {
      find(): string {
        return "real";
      }
    }

    @Injectable()
    class Service {
      constructor(@Inject(RealRepo) public repo: { find(): string }) {}
    }

    @Module({ providers: [RealRepo, Service] })
    class AppModule {}

    const fakeRepo = { find: () => "fake" };
    const app = await createApplication(AppModule, {
      overrides: [{ provide: RealRepo, useValue: fakeRepo }],
    });

    expect(app.get(Service).repo.find()).toBe("fake");
    expect(app.get(RealRepo)).toBe(fakeRepo);
  });

  it("has no effect when the override's token was never registered by the module graph", async () => {
    @Injectable()
    class Service {}

    @Module({ providers: [Service] })
    class AppModule {}

    const UNUSED = new InjectionToken<string>("unused");
    const app = await createApplication(AppModule, {
      overrides: [{ provide: UNUSED, useValue: "never applied" }],
    });

    expect(app.get(Service)).toBeInstanceOf(Service);
  });
});

describe("createApplication: module encapsulation", () => {
  it("allows a provider to depend on another provider declared in the same module", async () => {
    @Injectable()
    class Repo {}

    @Injectable()
    class Service {
      constructor(public repo: Repo) {}
    }

    @Module({ providers: [Repo, Service] })
    class FeatureModule {}

    const app = await createApplication(FeatureModule);

    expect(app.get(Service).repo).toBeInstanceOf(Repo);
  });

  it("allows a provider to depend on a token exported by a directly-imported module", async () => {
    @Injectable()
    class Shared {}

    @Module({ providers: [Shared], exports: [Shared] })
    class SharedModule {}

    @Injectable()
    class Service {
      constructor(public shared: Shared) {}
    }

    @Module({ imports: [SharedModule], providers: [Service] })
    class FeatureModule {}

    const app = await createApplication(FeatureModule);

    expect(app.get(Service).shared).toBeInstanceOf(Shared);
  });

  it("blocks a provider from depending on a token from an imported module that isn't exported", async () => {
    @Injectable()
    class Private {}

    @Module({ providers: [Private] })
    class SharedModule {}

    @Injectable()
    class Service {
      constructor(public priv: Private) {}
    }

    @Module({ imports: [SharedModule], providers: [Service] })
    class FeatureModule {}

    await expect(createApplication(FeatureModule)).rejects.toThrow(ProviderNotVisibleError);
    await expect(createApplication(FeatureModule)).rejects.toThrow(
      "Service depends on Private, but that belongs to SharedModule, which doesn't export it.",
    );
  });

  it("blocks a token that's only transitively imported (not re-exported by the module in between)", async () => {
    @Injectable()
    class Deep {}

    @Module({ providers: [Deep], exports: [Deep] })
    class DeepModule {}

    // Middle imports DeepModule but does NOT re-export Deep.
    @Module({ imports: [DeepModule] })
    class MiddleModule {}

    @Injectable()
    class Service {
      constructor(public deep: Deep) {}
    }

    @Module({ imports: [MiddleModule], providers: [Service] })
    class FeatureModule {}

    await expect(createApplication(FeatureModule)).rejects.toThrow(ProviderNotVisibleError);
  });

  it("global modules are visible everywhere without an explicit import", async () => {
    @Injectable()
    class Shared {}

    @Module({ providers: [Shared], exports: [Shared], global: true })
    class GlobalModule {}

    @Injectable()
    class Service {
      constructor(public shared: Shared) {}
    }

    // FeatureModule never imports GlobalModule directly.
    @Module({ providers: [Service] })
    class FeatureModule {}

    @Module({ imports: [GlobalModule, FeatureModule] })
    class AppModule {}

    const app = await createApplication(AppModule);

    expect(app.get(Service).shared).toBeInstanceOf(Shared);
  });

  it("applies the same rule to a controller's dependencies", async () => {
    @Injectable()
    class Private {}

    @Module({ providers: [Private] })
    class SharedModule {}

    @Injectable()
    class Ctrl {
      constructor(public priv: Private) {}
    }

    @Module({ imports: [SharedModule], controllers: [Ctrl] })
    class FeatureModule {}

    await expect(createApplication(FeatureModule)).rejects.toThrow(ProviderNotVisibleError);
  });

  it("checks a factory provider's inject list", async () => {
    @Injectable()
    class Private {}

    @Module({ providers: [Private] })
    class SharedModule {}

    const TOKEN = new InjectionToken<string>("derived");

    @Module({
      imports: [SharedModule],
      providers: [{ provide: TOKEN, useFactory: () => "x", inject: [Private] }],
    })
    class FeatureModule {}

    await expect(createApplication(FeatureModule)).rejects.toThrow(ProviderNotVisibleError);
  });

  it("a factory provider with no inject list has nothing to check", async () => {
    const TOKEN = new InjectionToken<string>("derived");

    @Module({ providers: [{ provide: TOKEN, useFactory: () => "x" }] })
    class FeatureModule {}

    const app = await createApplication(FeatureModule);

    expect(app.get(TOKEN)).toBe("x");
  });

  it("names a {provide, useClass} provider by its useClass in the error message", async () => {
    @Injectable()
    class Private {}

    @Module({ providers: [Private] })
    class SharedModule {}

    abstract class Base {}
    @Injectable()
    class Impl extends Base {
      constructor(public priv: Private) {
        super();
      }
    }

    @Module({ imports: [SharedModule], providers: [{ provide: Base, useClass: Impl }] })
    class FeatureModule {}

    await expect(createApplication(FeatureModule)).rejects.toThrow("Impl depends on Private");
  });

  it("checks a useExisting provider's alias target", async () => {
    @Injectable()
    class Private {}

    @Module({ providers: [Private] })
    class SharedModule {}

    const ALIAS = new InjectionToken<Private>("alias");

    @Module({ imports: [SharedModule], providers: [{ provide: ALIAS, useExisting: Private }] })
    class FeatureModule {}

    await expect(createApplication(FeatureModule)).rejects.toThrow(ProviderNotVisibleError);
  });

  it("an optional dependency on a token that exists but isn't visible still throws — not silently undefined", async () => {
    @Injectable()
    class Private {}

    @Module({ providers: [Private] })
    class SharedModule {}

    @Injectable()
    class Service {
      constructor(@Optional() public priv?: Private) {}
    }

    @Module({ imports: [SharedModule], providers: [Service] })
    class FeatureModule {}

    await expect(createApplication(FeatureModule)).rejects.toThrow(ProviderNotVisibleError);
  });

  it("an optional dependency on a token that doesn't exist anywhere still resolves to undefined", async () => {
    class NeverRegistered {}

    @Injectable()
    class Service {
      constructor(@Optional() public missing?: NeverRegistered) {}
    }

    @Module({ providers: [Service] })
    class FeatureModule {}

    const app = await createApplication(FeatureModule);

    expect(app.get(Service).missing).toBeUndefined();
  });
});

describe("createApplication: errors", () => {
  it("throws DuplicateProviderError when two modules register the same token", async () => {
    @Injectable()
    class Service {}

    @Module({ providers: [Service] })
    class FeatureA {}

    @Module({ providers: [Service] })
    class FeatureB {}

    @Module({ imports: [FeatureA, FeatureB] })
    class AppModule {}

    await expect(createApplication(AppModule)).rejects.toThrow(DuplicateProviderError);
  });

  it("throws NotAModuleError when an undecorated class is used as a module", async () => {
    class NotAModule {}

    await expect(createApplication(NotAModule)).rejects.toThrow(NotAModuleError);
  });
});

/** `Pool` is the dependency (closes last), `Flusher` depends on it (closes first). */
function fixture(flusherFails: boolean, poolFails = false) {
  const calls: string[] = [];

  @Injectable()
  class Pool {
    onApplicationShutdown(): void {
      calls.push("Pool");
      if (poolFails) {
        throw new Error("pool close failed");
      }
    }
  }

  @Injectable()
  class Flusher {
    constructor(@Inject(Pool) public pool: Pool) {}
    onApplicationShutdown(): void {
      calls.push("Flusher");
      if (flusherFails) {
        throw new Error("flush failed");
      }
    }
  }

  @Module({ providers: [Pool, Flusher] })
  class AppModule {}

  return { calls, AppModule };
}

describe("createApplication: a shutdown hook that fails", () => {
  it("still runs the hooks that come after it, so a failing flush cannot leave the pool open", async () => {
    const { calls, AppModule } = fixture(true);
    const app = await createApplication(AppModule);

    await expect(app.close()).rejects.toThrow("flush failed");

    expect(calls).toEqual(["Flusher", "Pool"]);
  });

  it("rethrows a single failure as it is, not wrapped", async () => {
    const { AppModule } = fixture(true);
    const app = await createApplication(AppModule);

    await expect(app.close()).rejects.not.toBeInstanceOf(AggregateError);
  });

  it("reports every failure in an AggregateError, in the order the hooks ran", async () => {
    const { calls, AppModule } = fixture(true, true);
    const app = await createApplication(AppModule);

    const error = await app.close().catch((caught: unknown) => caught);

    if (!(error instanceof AggregateError)) {
      throw new Error("expected close() to reject with an AggregateError");
    }
    expect(error.errors.map((inner: Error) => inner.message)).toEqual(["flush failed", "pool close failed"]);
    expect(calls).toEqual(["Flusher", "Pool"]);
  });

  it("is still closed afterwards: a second close() does not run the hooks again", async () => {
    const { calls, AppModule } = fixture(true);
    const app = await createApplication(AppModule);
    await app.close().catch(() => {});

    await app.close();

    expect(calls).toEqual(["Flusher", "Pool"]);
  });
});

describe("createApplication: a boot that fails", () => {
  it("shuts down the providers it had already built, in reverse order, when onModuleInit throws", async () => {
    const calls: string[] = [];

    @Injectable()
    class Pool {
      onApplicationShutdown(): void {
        calls.push("Pool");
      }
    }

    @Injectable()
    class Cache {
      constructor(@Inject(Pool) public pool: Pool) {}
      onApplicationShutdown(): void {
        calls.push("Cache");
      }
    }

    @Injectable()
    class Migrator {
      constructor(@Inject(Cache) public cache: Cache) {}
      onModuleInit(): void {
        throw new Error("migration failed");
      }
      onApplicationShutdown(): void {
        calls.push("Migrator");
      }
    }

    @Module({ providers: [Pool, Cache, Migrator] })
    class AppModule {}

    await expect(createApplication(AppModule)).rejects.toThrow("migration failed");

    // Everything that was constructed is closed, dependents first, including the provider whose init threw.
    expect(calls).toEqual(["Migrator", "Cache", "Pool"]);
  });

  it("shuts down what was built when a later provider's constructor throws", async () => {
    const calls: string[] = [];

    @Injectable()
    class Pool {
      onApplicationShutdown(): void {
        calls.push("Pool");
      }
    }

    @Injectable()
    class Broken {
      constructor(@Inject(Pool) public pool: Pool) {
        throw new Error("constructor failed");
      }
      onApplicationShutdown(): void {
        calls.push("Broken");
      }
    }

    @Module({ providers: [Pool, Broken] })
    class AppModule {}

    await expect(createApplication(AppModule)).rejects.toThrow("constructor failed");

    // `Broken` was never constructed, so it has nothing to close; `Pool` was.
    expect(calls).toEqual(["Pool"]);
  });

  it("waits for providers still being built when another fails, then shuts those down too", async () => {
    const calls: string[] = [];
    const SLOW = new InjectionToken<{ onApplicationShutdown(): void }>("slow");

    @Injectable()
    class Broken {
      constructor() {
        throw new Error("fails immediately");
      }
    }

    @Module({
      providers: [
        Broken,
        {
          provide: SLOW,
          useFactory: async () => {
            await new Promise((resolve) => setTimeout(resolve, 40));
            return {
              onApplicationShutdown: () => {
                calls.push("Slow");
              },
            };
          },
        },
      ],
    })
    class AppModule {}

    await expect(createApplication(AppModule)).rejects.toThrow("fails immediately");

    expect(calls).toEqual(["Slow"]);
  });

  it("shuts down when onApplicationBootstrap throws", async () => {
    const calls: string[] = [];

    @Injectable()
    class Resource {
      onApplicationShutdown(): void {
        calls.push("Resource");
      }
    }

    @Injectable()
    class Discoverer {
      onApplicationBootstrap(): void {
        throw new Error("bootstrap failed");
      }
    }

    @Module({ providers: [Resource, Discoverer] })
    class AppModule {}

    await expect(createApplication(AppModule)).rejects.toThrow("bootstrap failed");

    expect(calls).toEqual(["Resource"]);
  });

  it("rejects with the original error even when a shutdown hook also fails, and reports that failure", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    @Injectable()
    class Resource {
      onApplicationShutdown(): void {
        throw new Error("close failed too");
      }
    }

    @Injectable()
    class Broken {
      onModuleInit(): void {
        throw new Error("init failed");
      }
    }

    @Module({ providers: [Resource, Broken] })
    class AppModule {}

    await expect(createApplication(AppModule)).rejects.toThrow("init failed");

    expect(logged).toHaveBeenCalledOnce();
    expect(String(logged.mock.calls[0]?.[0])).toContain("while rolling back a failed boot");
    logged.mockRestore();
  });

  it("calls shutdown hooks with no signal, as it was not a signal that stopped it", async () => {
    const seen: unknown[] = [];

    @Injectable()
    class Resource {
      onApplicationShutdown(signal?: string): void {
        seen.push(signal);
      }
    }

    @Injectable()
    class Broken {
      onModuleInit(): void {
        throw new Error("init failed");
      }
    }

    @Module({ providers: [Resource, Broken] })
    class AppModule {}

    await createApplication(AppModule).catch(() => {});

    expect(seen).toEqual([undefined]);
  });
});
