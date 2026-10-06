import { Module, type OnApplicationShutdown, type OnModuleInit } from "@blixis-io/core";
import { Injectable, InjectionToken } from "@blixis-io/di";
import { describe, expect, it, vi } from "vitest";
import { Controller } from "./decorators/controller.js";
import { Get } from "./decorators/routes.js";
import { createFetchHandler } from "./fetch-handler.js";

const events: string[] = [];

@Injectable()
class Probe implements OnModuleInit, OnApplicationShutdown {
  onModuleInit(): void {
    events.push("init");
  }

  onApplicationShutdown(signal?: string): void {
    events.push(`shutdown:${signal ?? "none"}`);
  }
}

@Controller("ping")
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

@Module({ providers: [Probe], controllers: [PingController] })
class AppModule {}

const request = (path = "/ping") => new Request(`http://localhost${path}`);

describe("createFetchHandler", () => {
  it("serves requests through the normal handler", async () => {
    const handler = createFetchHandler(AppModule);

    const res = await handler.fetch(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await handler.fetch(request("/nope"))).status).toBe(404);
    await handler.close();
  });

  it("boots lazily: nothing happens until the first request", async () => {
    events.length = 0;
    const handler = createFetchHandler(AppModule);

    expect(events).toEqual([]);
    await handler.fetch(request());
    expect(events).toEqual(["init"]);
    await handler.close();
  });

  it("boots once, even for concurrent first requests and many later ones", async () => {
    events.length = 0;
    const handler = createFetchHandler(AppModule);

    await Promise.all([handler.fetch(request()), handler.fetch(request()), handler.fetch(request())]);
    await handler.fetch(request());

    expect(events).toEqual(["init"]);
    await handler.close();
  });

  it("answers a generic 500 when boot fails, logs the real error, and retries on the next request", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const TOKEN = new InjectionToken<string>("flaky");
    let attempts = 0;

    @Module({
      providers: [
        {
          provide: TOKEN,
          useFactory: () => {
            attempts += 1;
            if (attempts === 1) {
              throw new Error("database is not ready yet");
            }
            return "ready";
          },
        },
      ],
      controllers: [PingController],
    })
    class FlakyModule {}

    const handler = createFetchHandler(FlakyModule);

    const first = await handler.fetch(request());
    expect(first.status).toBe(500);
    expect(first.headers.get("content-type")).toBe("application/problem+json");
    expect(await first.json()).toEqual({ type: "about:blank", title: "Internal Server Error", status: 500, detail: "An unexpected error occurred" });
    expect(error.mock.calls[0]?.[0]).toMatchObject({ message: "database is not ready yet" });

    const second = await handler.fetch(request());
    expect(second.status).toBe(200);
    expect(attempts).toBe(2);

    error.mockRestore();
    await handler.close();
  });

  it("releases what a failed boot built before retrying, even when the failure is in building the handler", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    events.length = 0;

    @Controller("dup")
    class DuplicateRoutes {
      @Get("x")
      first() {
        return 1;
      }

      @Get("x")
      second() {
        return 2;
      }
    }

    @Module({ providers: [Probe], controllers: [DuplicateRoutes] })
    class BrokenModule {}

    const handler = createFetchHandler(BrokenModule);

    expect((await handler.fetch(request())).status).toBe(500);
    expect((await handler.fetch(request())).status).toBe(500);

    expect(events).toEqual(["init", "shutdown:none", "init", "shutdown:none"]);
    error.mockRestore();
  });

  it("never leaks the boot error to the client", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    @Module({ providers: [{ provide: new InjectionToken<string>("x"), useFactory: () => { throw new Error("SECRET connection string"); } }] })
    class BrokenModule {}

    const res = await createFetchHandler(BrokenModule).fetch(request());

    expect(await res.text()).not.toContain("SECRET");
    error.mockRestore();
  });

  it("close() runs shutdown hooks with the signal, and a later request boots a fresh app", async () => {
    events.length = 0;
    const handler = createFetchHandler(AppModule);
    await handler.fetch(request());

    await handler.close("SIGTERM");
    await handler.fetch(request());

    expect(events).toEqual(["init", "shutdown:SIGTERM", "init"]);
    await handler.close();
  });

  it("close() before any request, or after a failed boot, is a harmless no-op", async () => {
    events.length = 0;
    await createFetchHandler(AppModule).close();
    expect(events).toEqual([]);

    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    @Module({ providers: [{ provide: new InjectionToken<string>("y"), useFactory: () => { throw new Error("nope"); } }] })
    class BrokenModule {}

    const broken = createFetchHandler(BrokenModule);
    await broken.fetch(request());
    await expect(broken.close()).resolves.toBeUndefined();
    error.mockRestore();
  });

  it("passes options through to the application", async () => {
    @Controller("slow")
    class SlowController {
      @Get()
      async slow() {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { ok: true };
      }
    }

    @Module({ controllers: [SlowController] })
    class SlowModule {}

    const handler = createFetchHandler(SlowModule, { requestTimeout: 10 });

    expect((await handler.fetch(request("/slow"))).status).toBe(504);
    await handler.close();
  });

  it("is directly usable as a platform default export", async () => {
    const entry: { fetch(request: Request): Promise<Response> } = createFetchHandler(AppModule);

    expect((await entry.fetch(request())).status).toBe(200);
  });
});
