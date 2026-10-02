import { Module } from "@blixis-io/core";
import { Inject } from "@blixis-io/di";
import { Controller, createHttpApplication, Get, RequestContext, UseGuards } from "@blixis-io/http";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineAuthModule, Public, Roles } from "./module.js";

const SECRET = "test-secret-at-least-32-bytes-long!!";
const ClaimsSchema = z.object({ sub: z.string(), roles: z.array(z.string()).optional() });
const auth = defineAuthModule(ClaimsSchema);
const { AuthGuard, getCurrentUser } = auth;

const sign = (claims: Record<string, unknown>, secret = SECRET): Promise<string> =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .sign(new TextEncoder().encode(secret));

@Controller("things")
class ThingsController {
  constructor(@Inject(RequestContext) private readonly ctx: RequestContext) {}

  @Get("plain")
  plain() {
    return { user: getCurrentUser(this.ctx)?.sub ?? null };
  }

  @Get("open")
  @Public()
  open() {
    return { user: getCurrentUser(this.ctx)?.sub ?? null };
  }

  @Get("admin")
  @Roles("admin")
  admin() {
    return { ok: true };
  }

  @Get("either")
  @Roles("admin", "editor")
  either() {
    return { ok: true };
  }
}

@Controller("staff")
@Roles("staff")
class StaffController {
  @Get("list")
  list() {
    return { ok: true };
  }

  @Get("lobby")
  @Public()
  lobby() {
    return { ok: true };
  }

  @Get("boss")
  @Roles("boss")
  boss() {
    return { ok: true };
  }
}

async function appWith(options: { protectAllRoutes?: boolean } = {}, controllers: (new (...args: never[]) => object)[] = [ThingsController, StaffController]) {
  @Module({ imports: [auth.AuthModule.forRoot({ secret: SECRET, ...options })], controllers })
  class AppModule {}
  return createHttpApplication(AppModule);
}

const call = async (app: Awaited<ReturnType<typeof appWith>>, path: string, token?: string) =>
  app.handle(new Request(`http://localhost${path}`, token ? { headers: { authorization: `Bearer ${token}` } } : {}));

describe("protectAllRoutes: true", () => {
  it("rejects an unauthenticated request to an undecorated route with 401", async () => {
    const res = await call(await appWith({ protectAllRoutes: true }), "/things/plain");

    expect(res.status).toBe(401);
  });

  it("lets a valid token through, and exposes the current user to the handler", async () => {
    const app = await appWith({ protectAllRoutes: true });

    const res = await call(app, "/things/plain", await sign({ sub: "u1" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: "u1" });
  });

  it.each([
    ["a bad signature", () => sign({ sub: "u1" }, "another-secret-that-is-long-enough!!!")],
    ["a payload that fails the claims schema", () => sign({ nope: true })],
  ])("rejects %s with 401", async (_label, makeToken) => {
    const res = await call(await appWith({ protectAllRoutes: true }), "/things/plain", await makeToken());

    expect(res.status).toBe(401);
  });

  it("@Public() opens a route without a token, and skips authentication even when one is sent", async () => {
    const app = await appWith({ protectAllRoutes: true });

    const anonymous = await call(app, "/things/open");
    const withToken = await call(app, "/things/open", await sign({ sub: "u1" }));

    expect(anonymous.status).toBe(200);
    expect(await anonymous.json()).toEqual({ user: null });
    expect(await withToken.json()).toEqual({ user: null });
  });

  it("@Roles: 401 without a token, 403 without the role, 200 with it", async () => {
    const app = await appWith({ protectAllRoutes: true });

    expect((await call(app, "/things/admin")).status).toBe(401);
    expect((await call(app, "/things/admin", await sign({ sub: "u", roles: ["user"] }))).status).toBe(403);
    expect((await call(app, "/things/admin", await sign({ sub: "u" }))).status).toBe(403);
    expect((await call(app, "/things/admin", await sign({ sub: "u", roles: ["admin"] }))).status).toBe(200);
  });

  it("@Roles with several roles needs at least one of them", async () => {
    const app = await appWith({ protectAllRoutes: true });

    expect((await call(app, "/things/either", await sign({ sub: "u", roles: ["editor"] }))).status).toBe(200);
    expect((await call(app, "/things/either", await sign({ sub: "u", roles: ["admin", "x"] }))).status).toBe(200);
    expect((await call(app, "/things/either", await sign({ sub: "u", roles: ["viewer"] }))).status).toBe(403);
  });

  it("a controller-level @Roles covers its routes, @Public overrides it, and a method's @Roles replaces it", async () => {
    const app = await appWith({ protectAllRoutes: true });
    const staff = await sign({ sub: "s", roles: ["staff"] });

    expect((await call(app, "/staff/list", staff)).status).toBe(200);
    expect((await call(app, "/staff/list", await sign({ sub: "x", roles: ["other"] }))).status).toBe(403);
    expect((await call(app, "/staff/lobby")).status).toBe(200);
    expect((await call(app, "/staff/boss", staff)).status).toBe(403);
    expect((await call(app, "/staff/boss", await sign({ sub: "b", roles: ["boss"] }))).status).toBe(200);
  });

  it("covers routes of controllers the app's modules add later, with no per-route wiring", async () => {
    @Controller("later")
    class LaterController {
      @Get("secret")
      secret() {
        return { ok: true };
      }
    }

    const app = await appWith({ protectAllRoutes: true }, [LaterController]);

    expect((await call(app, "/later/secret")).status).toBe(401);
  });
});

describe("protectAllRoutes off (the default)", () => {
  it("changes nothing: undecorated routes stay open, and @Roles alone enforces nothing", async () => {
    const app = await appWith();

    expect((await call(app, "/things/plain")).status).toBe(200);
    expect((await call(app, "/things/admin")).status).toBe(200);
  });

  it("@UseGuards(AuthGuard) protects a controller and enforces its @Roles", async () => {
    @Controller("guarded")
    @UseGuards(AuthGuard)
    class GuardedController {
      @Get("any")
      any() {
        return { ok: true };
      }

      @Get("admin")
      @Roles("admin")
      admin() {
        return { ok: true };
      }

      @Get("open")
      @Public()
      open() {
        return { ok: true };
      }
    }

    const app = await appWith({}, [GuardedController]);

    expect((await call(app, "/guarded/any")).status).toBe(401);
    expect((await call(app, "/guarded/any", await sign({ sub: "u" }))).status).toBe(200);
    expect((await call(app, "/guarded/admin", await sign({ sub: "u", roles: ["user"] }))).status).toBe(403);
    expect((await call(app, "/guarded/admin", await sign({ sub: "u", roles: ["admin"] }))).status).toBe(200);
    expect((await call(app, "/guarded/open")).status).toBe(200);
  });
});
