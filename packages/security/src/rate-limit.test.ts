import { Module } from "@blixis-io/core";
import { Controller, createHttpApplication, Get, Post, type Middleware } from "@blixis-io/http";
import { describe, expect, it, vi } from "vitest";
import { MemoryRateLimitStore } from "./memory-store.js";
import { rateLimit, type RateLimitHit, type RateLimitStore } from "./rate-limit.js";

@Controller("auth")
class AuthController {
  @Post("sign-in")
  signIn() {
    return { token: "t" };
  }
}

@Controller("things")
class ThingsController {
  @Get()
  list() {
    return { ok: true };
  }
}

@Module({ controllers: [AuthController, ThingsController] })
class AppModule {}

type App = Awaited<ReturnType<typeof createHttpApplication>>;
const appWith = (...middleware: Middleware[]) => createHttpApplication(AppModule, { middleware });
const get = (app: App, path: string, headers: Record<string, string> = {}) => app.handle(new Request(`http://localhost${path}`, { headers }));
const post = (app: App, path: string, headers: Record<string, string> = {}) => app.handle(new Request(`http://localhost${path}`, { method: "POST", headers }));

/** A store whose answers a test writes down, and which remembers what it was asked. */
class ScriptedStore implements RateLimitStore {
  readonly asked: Array<{ key: string; windowMs: number }> = [];
  constructor(private readonly answer: (key: string) => RateLimitHit) {}
  hit(key: string, windowMs: number): Promise<RateLimitHit> {
    this.asked.push({ key, windowMs });
    return Promise.resolve(this.answer(key));
  }
}

describe("rateLimit(): configuration", () => {
  const store = new MemoryRateLimitStore();

  it.each([[0], [-1], [1.5], [Number.NaN]])("refuses a limit of %s", (limit) => {
    expect(() => rateLimit({ store, limit, windowMs: 1000 })).toThrow(RangeError);
  });

  it.each([[0], [-5], [0.5]])("refuses a window of %s ms", (windowMs) => {
    expect(() => rateLimit({ store, limit: 5, windowMs })).toThrow(RangeError);
  });
});

describe("rateLimit(): counting", () => {
  it("lets requests through up to the limit and then answers 429 problem+json with Retry-After", async () => {
    const app = await appWith(rateLimit({ store: new MemoryRateLimitStore(), limit: 3, windowMs: 60_000, key: () => "caller" }));

    const statuses: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      statuses.push((await get(app, "/things")).status);
    }
    const limited = await get(app, "/things");

    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(limited.headers.get("content-type")).toBe("application/problem+json");
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(limited.headers.get("ratelimit-remaining")).toBe("0");
    expect(await limited.json()).toMatchObject({ status: 429, detail: "Too many requests" });
    await app.close();
  });

  it("describes the budget on every counted response", async () => {
    const app = await appWith(rateLimit({ store: new MemoryRateLimitStore(), limit: 3, windowMs: 60_000, key: () => "caller" }));

    const first = await get(app, "/things");
    const second = await get(app, "/things");

    expect([first.headers.get("ratelimit-limit"), first.headers.get("ratelimit-remaining")]).toEqual(["3", "2"]);
    expect(second.headers.get("ratelimit-remaining")).toBe("1");
    expect(Number(second.headers.get("ratelimit-reset"))).toBeLessThanOrEqual(60);
    await app.close();
  });

  it("keeps different keys apart", async () => {
    const app = await appWith(rateLimit({ store: new MemoryRateLimitStore(), limit: 1, windowMs: 60_000, key: (request) => request.headers.get("x-user") ?? undefined }));

    expect((await get(app, "/things", { "x-user": "a" })).status).toBe(200);
    expect((await get(app, "/things", { "x-user": "b" })).status).toBe(200);
    expect((await get(app, "/things", { "x-user": "a" })).status).toBe(429);
    await app.close();
  });

  it("counts requests whose key cannot be determined under one shared key", async () => {
    const store = new ScriptedStore(() => ({ count: 1, resetAt: Date.now() + 1000 }));
    const app = await appWith(rateLimit({ store, limit: 5, windowMs: 1000, key: () => undefined }));

    await get(app, "/things");

    expect(store.asked.map((entry) => entry.key)).toEqual(["default:unknown"]);
    await app.close();
  });

  it("only counts the requests match() selects", async () => {
    const app = await appWith(
      rateLimit({ store: new MemoryRateLimitStore(), limit: 1, windowMs: 60_000, key: () => "caller", match: (request) => new URL(request.url).pathname === "/auth/sign-in" }),
    );

    expect((await post(app, "/auth/sign-in")).status).toBe(200);
    expect((await post(app, "/auth/sign-in")).status).toBe(429);
    expect((await get(app, "/things")).status).toBe(200);
    expect((await get(app, "/things")).status).toBe(200);
    expect((await get(app, "/things")).headers.get("ratelimit-limit")).toBeNull();
    await app.close();
  });

  it("keeps two limits sharing one store apart with name", async () => {
    const store = new MemoryRateLimitStore();
    const app = await appWith(
      rateLimit({ store, name: "strict", limit: 1, windowMs: 60_000, key: () => "caller", match: (request) => request.method === "POST" }),
      rateLimit({ store, name: "loose", limit: 100, windowMs: 60_000, key: () => "caller" }),
    );

    expect((await post(app, "/auth/sign-in")).status).toBe(200);
    expect((await post(app, "/auth/sign-in")).status).toBe(429);
    expect((await get(app, "/things")).status).toBe(200);
    await app.close();
  });

  it("uses a custom message", async () => {
    const app = await appWith(rateLimit({ store: new MemoryRateLimitStore(), limit: 1, windowMs: 60_000, key: () => "c", message: "Slow down" }));
    await get(app, "/things");

    expect(await (await get(app, "/things")).json()).toMatchObject({ detail: "Slow down" });
    await app.close();
  });

  it("passes the window to the store and prefixes the key with the name", async () => {
    const store = new ScriptedStore(() => ({ count: 1, resetAt: Date.now() + 5000 }));
    const app = await appWith(rateLimit({ store, name: "api", limit: 5, windowMs: 5000, key: () => "u1" }));

    await get(app, "/things");

    expect(store.asked).toEqual([{ key: "api:u1", windowMs: 5000 }]);
    await app.close();
  });
});

describe("rateLimit(): the client address as the default key", () => {
  it("uses the address of the peer by default, and X-Forwarded-For only when proxies are trusted", async () => {
    const store = new ScriptedStore(() => ({ count: 1, resetAt: Date.now() + 1000 }));
    const direct = await createHttpApplication(AppModule, { middleware: [rateLimit({ store, limit: 5, windowMs: 1000 })] });
    const proxied = await createHttpApplication(AppModule, { middleware: [rateLimit({ store, limit: 5, windowMs: 1000, clientIp: { trustedProxyHops: 1 } })] });
    const directPort = (await direct.listen(0, "127.0.0.1")).port;
    const proxiedPort = (await proxied.listen(0, "127.0.0.1")).port;

    await fetch(`http://127.0.0.1:${directPort}/things`, { headers: { "x-forwarded-for": "203.0.113.7" } });
    await fetch(`http://127.0.0.1:${proxiedPort}/things`, { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.7" } });

    expect(store.asked.map((entry) => entry.key)).toEqual(["default:127.0.0.1", "default:203.0.113.7"]);
    await direct.close();
    await proxied.close();
  });
});

describe("rateLimit(): when the store fails", () => {
  const broken: RateLimitStore = { hit: () => Promise.reject(new Error("database is down")) };

  it("lets the request through by default, and says so on the error stream", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await appWith(rateLimit({ store: broken, limit: 1, windowMs: 1000, key: () => "c" }));

    expect((await get(app, "/things")).status).toBe(200);
    expect(error.mock.calls[0]?.[0]).toContain("rate-limit store failed");
    error.mockRestore();
    await app.close();
  });

  it("answers 503 when told to block", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await appWith(rateLimit({ store: broken, limit: 1, windowMs: 1000, key: () => "c", onStoreError: "block" }));

    const response = await get(app, "/things");

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    error.mockRestore();
    await app.close();
  });
});
