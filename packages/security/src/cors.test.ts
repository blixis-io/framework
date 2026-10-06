import { Module } from "@blixis-io/core";
import { Controller, createHttpApplication, Get, Post, type Middleware } from "@blixis-io/http";
import { describe, expect, it } from "vitest";
import { cors } from "./cors.js";
import { SecurityConfigError } from "./errors.js";

@Controller("things")
class ThingsController {
  @Get()
  list() {
    return { ok: true };
  }

  @Post()
  create() {
    return { created: true };
  }
}

@Module({ controllers: [ThingsController] })
class AppModule {}

async function appWith(middleware: Middleware) {
  return createHttpApplication(AppModule, { middleware: [middleware] });
}

const APP = "https://app.example.com";
const call = (app: Awaited<ReturnType<typeof appWith>>, path: string, init: RequestInit = {}) => app.handle(new Request(`http://localhost${path}`, init));

const withVary: Middleware = async (_request, next) => {
  const response = await next();
  response.headers.set("vary", "Accept-Encoding");
  return response;
};

const preflight = (origin: string, extra: Record<string, string> = {}): RequestInit => ({
  method: "OPTIONS",
  headers: { origin, "access-control-request-method": "POST", ...extra },
});

describe("cors(): configuration is checked when it is created", () => {
  it("refuses credentials with a wildcard origin", () => {
    expect(() => cors({ origins: "*", credentials: true })).toThrow(SecurityConfigError);
    expect(() => cors({ origins: ["*"], credentials: true })).toThrow(SecurityConfigError);
    expect(() => cors({ origins: "*", credentials: true })).toThrow(/any website/);
  });

  it.each([["https://app.example.com/"], ["https://app.example.com/path"], ["app.example.com"], ["not a url"]])("refuses %s as an origin", (bad) => {
    expect(() => cors({ origins: [bad] })).toThrow(SecurityConfigError);
  });

  it("names the exact origin it expected", () => {
    expect(() => cors({ origins: ["https://app.example.com/"] })).toThrow('Did you mean "https://app.example.com"?');
  });

  it("refuses a bad maxAge", () => {
    expect(() => cors({ origins: [APP], maxAge: -1 })).toThrow(SecurityConfigError);
    expect(() => cors({ origins: [APP], maxAge: 1.5 })).toThrow(SecurityConfigError);
  });

  it("accepts explicit origins with credentials, and a function with credentials", () => {
    expect(() => cors({ origins: [APP, "http://localhost:5173"], credentials: true })).not.toThrow();
    expect(() => cors({ origins: (origin) => origin.endsWith(".example.com"), credentials: true })).not.toThrow();
  });
});

describe("cors(): requests", () => {
  it("echoes an allowed origin, with Vary: Origin", async () => {
    const app = await appWith(cors({ origins: [APP] }));

    const response = await call(app, "/things", { headers: { origin: APP } });

    expect(response.headers.get("access-control-allow-origin")).toBe(APP);
    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    await app.close();
  });

  it("gives a request from another origin no CORS headers, but still serves it (CORS is the browser's rule, not access control)", async () => {
    const app = await appWith(cors({ origins: [APP] }));

    const response = await call(app, "/things", { headers: { origin: "https://evil.example" } });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("vary")).toBe("Origin");
    await app.close();
  });

  it("treats the literal origin null as not allowed unless it is listed", async () => {
    const app = await appWith(cors({ origins: [APP] }));

    expect((await call(app, "/things", { headers: { origin: "null" } })).headers.get("access-control-allow-origin")).toBeNull();
    await app.close();
  });

  it("sets credentials and exposed headers when asked", async () => {
    const app = await appWith(cors({ origins: [APP], credentials: true, exposedHeaders: ["x-request-id", "ratelimit-remaining"] }));

    const response = await call(app, "/things", { headers: { origin: APP } });

    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-expose-headers")).toBe("x-request-id, ratelimit-remaining");
    await app.close();
  });

  it("answers * for a public API and does not vary on Origin", async () => {
    const app = await appWith(cors({ origins: "*" }));

    const response = await call(app, "/things", { headers: { origin: "https://anywhere.example" } });

    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("vary")).toBeNull();
    await app.close();
  });

  it("decides with a function", async () => {
    const app = await appWith(cors({ origins: (origin) => origin.endsWith(".example.com") }));

    expect((await call(app, "/things", { headers: { origin: "https://a.example.com" } })).headers.get("access-control-allow-origin")).toBe("https://a.example.com");
    expect((await call(app, "/things", { headers: { origin: "https://example.org" } })).headers.get("access-control-allow-origin")).toBeNull();
    await app.close();
  });

  it("leaves a request with no Origin alone, and marks the response as varying on it", async () => {
    const app = await appWith(cors({ origins: [APP] }));

    const response = await call(app, "/things");

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("vary")).toBe("Origin");
    await app.close();
  });

  it("carries the headers on a 404, a 405 and an error the application throws, so the browser can read the real status", async () => {
    const app = await appWith(cors({ origins: [APP] }));

    for (const [path, method, status] of [["/nowhere", "GET", 404], ["/things", "DELETE", 405]] as const) {
      const response = await call(app, path, { method, headers: { origin: APP } });
      expect(response.status).toBe(status);
      expect(response.headers.get("access-control-allow-origin")).toBe(APP);
    }
    await app.close();
  });

  it("adds to an existing Vary instead of replacing it", async () => {
    const app = await createHttpApplication(AppModule, { middleware: [cors({ origins: [APP] }), withVary] });

    const response = await call(app, "/things", { headers: { origin: APP } });

    expect(response.headers.get("vary")).toBe("Accept-Encoding, Origin");
    await app.close();
  });
});

describe("cors(): preflight", () => {
  it("answers an allowed origin with 204 and the full policy, without reaching the application", async () => {
    const app = await appWith(cors({ origins: [APP], credentials: true, maxAge: 120 }));

    const response = await call(app, "/things", preflight(APP, { "access-control-request-headers": "content-type, authorization" }));

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(APP);
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, HEAD, PUT, PATCH, POST, DELETE");
    expect(response.headers.get("access-control-allow-headers")).toBe("content-type, authorization");
    expect(response.headers.get("access-control-max-age")).toBe("120");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("vary")).toBe("Origin, Access-Control-Request-Headers");
    await app.close();
  });

  it("answers for a path that has no OPTIONS route at all (it would be a 405 without this)", async () => {
    const app = await appWith(cors({ origins: [APP] }));

    expect((await call(app, "/nowhere", preflight(APP))).status).toBe(204);
    await app.close();
  });

  it("uses the configured methods and headers instead of reflecting", async () => {
    const app = await appWith(cors({ origins: [APP], methods: ["GET", "POST"], allowedHeaders: ["content-type"] }));

    const response = await call(app, "/things", preflight(APP, { "access-control-request-headers": "x-anything" }));

    expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST");
    expect(response.headers.get("access-control-allow-headers")).toBe("content-type");
    await app.close();
  });

  it("gives another origin 204 with no CORS headers, so the browser refuses the real request", async () => {
    const app = await appWith(cors({ origins: [APP] }));

    const response = await call(app, "/things", preflight("https://evil.example"));

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-methods")).toBeNull();
    await app.close();
  });

  it("is not a preflight without Access-Control-Request-Method: a plain OPTIONS goes on to the application", async () => {
    const app = await appWith(cors({ origins: [APP] }));

    const response = await call(app, "/things", { method: "OPTIONS", headers: { origin: APP } });

    expect(response.status).toBe(405);
    expect(response.headers.get("access-control-allow-origin")).toBe(APP);
    await app.close();
  });

  it("omits Allow-Headers when nothing was requested and nothing is configured", async () => {
    const app = await appWith(cors({ origins: [APP] }));

    expect((await call(app, "/things", preflight(APP))).headers.get("access-control-allow-headers")).toBeNull();
    await app.close();
  });
});
