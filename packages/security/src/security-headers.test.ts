import { Module } from "@blixis-io/core";
import { Controller, createHttpApplication, Get, type Middleware } from "@blixis-io/http";
import { describe, expect, it } from "vitest";
import { securityHeaders } from "./security-headers.js";

@Controller("things")
class ThingsController {
  @Get()
  list() {
    return { ok: true };
  }

  @Get("redirect")
  redirect() {
    return Response.redirect("http://localhost/things", 302);
  }

  @Get("framed")
  framed() {
    return new Response("{}", { headers: { "x-frame-options": "SAMEORIGIN", "content-type": "application/json" } });
  }
}

@Module({ controllers: [ThingsController] })
class AppModule {}

const get = (app: Awaited<ReturnType<typeof createHttpApplication>>, path: string) => app.handle(new Request(`http://localhost${path}`));
const appWith = (middleware: Middleware) => createHttpApplication(AppModule, { middleware: [middleware] });

describe("securityHeaders()", () => {
  it("sets conservative defaults on a success, a 404 and a response with immutable headers", async () => {
    const app = await appWith(securityHeaders());

    for (const path of ["/things", "/nowhere", "/things/redirect"]) {
      const response = await get(app, path);
      expect([path, response.headers.get("x-content-type-options")]).toEqual([path, "nosniff"]);
      expect([path, response.headers.get("referrer-policy")]).toEqual([path, "no-referrer"]);
      expect([path, response.headers.get("x-frame-options")]).toEqual([path, "DENY"]);
      expect([path, response.headers.get("content-security-policy")]).toEqual([path, "default-src 'none'; frame-ancestors 'none'"]);
      expect([path, response.headers.get("cross-origin-resource-policy")]).toEqual([path, "same-origin"]);
    }
    await app.close();
  });

  it("leaves HSTS out by default", async () => {
    const app = await appWith(securityHeaders());

    expect((await get(app, "/things")).headers.get("strict-transport-security")).toBeNull();
    await app.close();
  });

  it("sets HSTS when asked", async () => {
    const app = await appWith(securityHeaders({ hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true } }));

    expect((await get(app, "/things")).headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
    await app.close();
  });

  it("changes or removes a header with an option", async () => {
    const app = await appWith(securityHeaders({ frameOptions: "SAMEORIGIN", referrerPolicy: false, contentSecurityPolicy: false }));

    const response = await get(app, "/things");

    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("referrer-policy")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBeNull();
    await app.close();
  });

  it("keeps a value the application set itself, unless told to override", async () => {
    const kept = await appWith(securityHeaders());
    const replaced = await appWith(securityHeaders({ override: true }));

    expect((await get(kept, "/things/framed")).headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect((await get(replaced, "/things/framed")).headers.get("x-frame-options")).toBe("DENY");
    await kept.close();
    await replaced.close();
  });

  it("refuses a bad HSTS max-age", () => {
    expect(() => securityHeaders({ hsts: { maxAge: -1 } })).toThrow(RangeError);
  });
});
