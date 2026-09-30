import { DuplicateProviderError, Inject, Injectable, InjectionToken, Optional } from "@blixis-io/di";
import { describe, expect, it } from "vitest";
import { createApplication } from "./application.js";
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
