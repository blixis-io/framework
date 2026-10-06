import { Module } from "@blixis-io/core";
import { Inject, Injectable } from "@blixis-io/di";
import { Controller, createHttpApplication, Get, type Middleware } from "@blixis-io/http";
import { describe, expect, it, vi } from "vitest";
import { createHealth, defineHealthModule } from "./health.js";

@Controller("things")
class ThingsController {
  @Get()
  list() {
    return { ok: true };
  }
}

@Module({ controllers: [ThingsController] })
class AppModule {}

type App = Awaited<ReturnType<typeof createHttpApplication>>;
const request = (app: App, path: string, method = "GET") => app.handle(new Request(`http://localhost${path}`, { method }));
const appWith = (...middleware: Middleware[]) => createHttpApplication(AppModule, { middleware });
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));


describe("liveness", () => {
  it("answers 200 on /livez whatever the readiness checks say, and never calls them", async () => {
    const health = createHealth();
    const check = vi.fn<() => Promise<void>>(() => Promise.reject(new Error("db down")));
    health.check("database", check);
    const app = await appWith(health.middleware);

    const response = await request(app, "/livez");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(check).not.toHaveBeenCalled();
    await app.close();
  });

  it("says nothing is cached", async () => {
    const app = await appWith(createHealth().middleware);

    expect((await request(app, "/livez")).headers.get("cache-control")).toBe("no-store");
    await app.close();
  });

  it("is still alive while draining: a restart is the answer to a dead process, not to a shutting-down one", async () => {
    const health = createHealth();
    const app = await appWith(health.middleware);
    health.watch(app);
    app.startDraining();

    expect((await request(app, "/livez")).status).toBe(200);
    await app.close();
  });
});

describe("readiness", () => {
  it("is 200 with no checks at all", async () => {
    const app = await appWith(createHealth().middleware);

    const response = await request(app, "/readyz");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", checks: {} });
    await app.close();
  });

  it("is 200 when every check passes, naming each with its time", async () => {
    const health = createHealth();
    health.check("database", async () => {});
    health.check("cache", () => {});
    const app = await appWith(health.middleware);

    const response = await request(app, "/readyz");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      checks: { database: { status: "ok", durationMs: expect.any(Number) }, cache: { status: "ok", durationMs: expect.any(Number) } },
    });
    await app.close();
  });

  it("is 503 when one check fails, says which, and never puts the error in the body", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const health = createHealth();
    health.check("database", () => Promise.reject(new Error("password authentication failed for user admin")));
    health.check("cache", () => {});
    const app = await appWith(health.middleware);

    const response = await request(app, "/readyz");
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toMatchObject({ status: "fail", checks: { database: { status: "fail" }, cache: { status: "ok" } } });
    expect(text).not.toContain("password");
    error.mockRestore();
    await app.close();
  });

  it("counts a synchronous throw as a failure too", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const health = createHealth();
    health.check("config", () => {
      throw new Error("missing");
    });
    const app = await appWith(health.middleware);

    expect((await request(app, "/readyz")).status).toBe(503);
    error.mockRestore();
    await app.close();
  });

  it("fails a check that does not finish within the timeout, instead of hanging the probe", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const health = createHealth({ checkTimeoutMs: 40 });
    health.check("slow", () => new Promise<void>(() => {}));
    const app = await appWith(health.middleware);

    const started = Date.now();
    const response = await request(app, "/readyz");

    expect(response.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(1000);
    error.mockRestore();
    await app.close();
  });

  it("runs the checks at the same time, so the probe takes as long as the slowest", async () => {
    const health = createHealth();
    health.check("a", () => sleep(150));
    health.check("b", () => sleep(150));
    health.check("c", () => sleep(150));
    const app = await appWith(health.middleware);

    const started = Date.now();
    await request(app, "/readyz");

    expect(Date.now() - started).toBeLessThan(400);
    await app.close();
  });

  it("recovers: a check that failed and then passes makes the endpoint ready again", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const health = createHealth();
    let up = false;
    health.check("database", () => (up ? undefined : Promise.reject(new Error("down"))));
    const app = await appWith(health.middleware);

    expect((await request(app, "/readyz")).status).toBe(503);
    up = true;
    expect((await request(app, "/readyz")).status).toBe(200);
    error.mockRestore();
    await app.close();
  });

  it("removes a check with the function check() returned, and replaces one registered under the same name", async () => {
    const health = createHealth();
    const remove = health.check("database", () => Promise.reject(new Error("down")));
    health.check("database", () => {}); // replaces
    const app = await appWith(health.middleware);
    expect((await request(app, "/readyz")).status).toBe(200);

    remove(); // the first one: already replaced, so this must not remove the second
    expect(Object.keys((await health.ready()).checks)).toEqual(["database"]);
    await app.close();
  });

  it("answers HEAD with the same status and no body", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const health = createHealth();
    health.check("database", () => Promise.reject(new Error("down")));
    const app = await appWith(health.middleware);

    const response = await request(app, "/readyz", "HEAD");

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
    error.mockRestore();
    await app.close();
  });
});

describe("draining", () => {
  it("is ready until the application starts draining, then 503 'draining' while liveness stays 200", async () => {
    const health = createHealth();
    health.check("database", () => {});
    const app = await appWith(health.middleware);
    health.watch(app);

    expect((await request(app, "/readyz")).status).toBe(200);
    app.startDraining();
    const draining = await request(app, "/readyz");

    expect(draining.status).toBe(503);
    expect(await draining.json()).toMatchObject({ status: "draining" });
    expect((await request(app, "/livez")).status).toBe(200);
    await app.close();
  });

  it("reports draining the moment close() starts, to a probe that is still being answered", async () => {
    const health = createHealth();
    const app = await createHttpApplication(AppModule, { middleware: [health.middleware], shutdownTimeout: 5000 });
    health.watch(app);
    const { port } = await app.listen(0, "127.0.0.1");
    const keepAlive = new AbortController();
    const held = fetch(`http://127.0.0.1:${port}/things`, { signal: keepAlive.signal });
    await held;

    const closing = app.close();
    expect((await health.ready()).status).toBe("draining");
    await closing;
  });

  it("does not report draining for an application that is not being watched", async () => {
    const health = createHealth();
    const app = await appWith(health.middleware);
    app.startDraining();

    expect((await health.ready()).status).toBe("ok");
    await app.close();
  });
});

describe("what it leaves alone", () => {
  it("passes every other path, and a non-GET on the probe paths, on to the application", async () => {
    const app = await appWith(createHealth().middleware);

    expect((await request(app, "/things")).status).toBe(200);
    expect((await request(app, "/nowhere")).status).toBe(404);
    expect((await request(app, "/readyz", "POST")).status).toBe(404);
    expect((await request(app, "/livez", "DELETE")).status).toBe(404);
    await app.close();
  });

  it("uses other paths when asked", async () => {
    const app = await appWith(createHealth({ livePath: "/health/live", readyPath: "/health/ready" }).middleware);

    expect((await request(app, "/health/live")).status).toBe(200);
    expect((await request(app, "/health/ready")).status).toBe(200);
    expect((await request(app, "/livez")).status).toBe(404);
    await app.close();
  });

  it("is answered before a middleware further in, so a limiter never counts a probe", async () => {
    const counted: string[] = [];
    const counter: Middleware = (req, next) => {
      counted.push(new URL(req.url).pathname);
      return next();
    };
    const app = await appWith(createHealth().middleware, counter);

    await request(app, "/livez");
    await request(app, "/readyz");
    await request(app, "/things");

    expect(counted).toEqual(["/things"]);
    await app.close();
  });
});

describe("failures are reported once, where they begin", () => {
  it("writes a check that starts failing to console.error once, not on every probe, and again after it recovered and failed anew", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const health = createHealth();
    let up = false;
    health.check("database", () => (up ? undefined : Promise.reject(new Error("down"))));
    const app = await appWith(health.middleware);

    await request(app, "/readyz");
    await request(app, "/readyz");
    await request(app, "/readyz");
    expect(error).toHaveBeenCalledTimes(1);

    up = true;
    await request(app, "/readyz");
    up = false;
    await request(app, "/readyz");

    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
    await app.close();
  });

  it("hands every failure of every probe to onCheckFailed when given, and then does not write to console.error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failures: Array<[string, unknown]> = [];
    const health = createHealth({ onCheckFailed: (name, cause) => failures.push([name, cause]) });
    health.check("database", () => Promise.reject(new Error("down")));
    const app = await appWith(health.middleware);

    await request(app, "/readyz");
    await request(app, "/readyz");

    expect(failures.map(([name]) => name)).toEqual(["database", "database"]);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
    await app.close();
  });

  it("survives an onCheckFailed that throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const health = createHealth({
      onCheckFailed: () => {
        throw new Error("logger is down");
      },
    });
    health.check("database", () => Promise.reject(new Error("down")));
    const app = await appWith(health.middleware);

    expect((await request(app, "/readyz")).status).toBe(503);
    error.mockRestore();
    await app.close();
  });
});

describe("configuration", () => {
  it("refuses the same path for both", () => {
    expect(() => createHealth({ livePath: "/health", readyPath: "/health" })).toThrow(RangeError);
  });

  it.each([[0], [-1], [1.5]])("refuses a check timeout of %s", (checkTimeoutMs) => {
    expect(() => createHealth({ checkTimeoutMs })).toThrow(RangeError);
  });
});

describe("defineHealthModule: checks registered by the providers that own the dependency", () => {
  it("lets a provider register its check, so the endpoint reflects what the provider knows", async () => {
    const { health, HEALTH, HealthModule } = defineHealthModule();
    const state = { databaseUp: true };

    @Injectable()
    class Database {
      constructor(@Inject(HEALTH) healthRegistry: typeof health) {
        healthRegistry.check("database", () => (state.databaseUp ? undefined : Promise.reject(new Error("down"))));
      }
    }

    @Module({ imports: [HealthModule.forRoot()], providers: [Database], controllers: [ThingsController] })
    class WithHealth {}

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await createHttpApplication(WithHealth, { middleware: [health.middleware] });
    health.watch(app);

    expect((await request(app, "/readyz")).status).toBe(200);
    state.databaseUp = false;
    expect((await request(app, "/readyz")).status).toBe(503);
    error.mockRestore();
    await app.close();
  });

  it("gives each defineHealthModule() its own registry", () => {
    const first = defineHealthModule();
    const second = defineHealthModule();

    first.health.check("only-first", () => {});

    expect(first.HEALTH).not.toBe(second.HEALTH);
    return expect(second.health.ready()).resolves.toMatchObject({ checks: {} });
  });
});
