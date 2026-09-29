import { DuplicateProviderError, Inject, Injectable, InjectionToken } from "@blixis/di";
import { describe, expect, it } from "vitest";
import { createApplication } from "./application.js";
import { NotAModuleError } from "./errors.js";
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
