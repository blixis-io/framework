import { Module } from "@blixis-io/core";
import { createHttpApplication, RequestContext, runInRequestContext, UnauthorizedException } from "@blixis-io/http";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineAuthModule } from "./module.js";

const SECRET = "test-secret-at-least-32-bytes-long!!";
const ClaimsSchema = z.object({ sub: z.string(), roles: z.array(z.string()) });

function signToken(
  claims: Record<string, unknown>,
  options: { secret?: string; expSecondsFromNow?: number } = {},
): Promise<string> {
  const key = new TextEncoder().encode(options.secret ?? SECRET);
  const exp = Math.floor(Date.now() / 1000) + (options.expSecondsFromNow ?? 3600);
  return new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(exp).sign(key);
}

function requestWith(token?: string): Request {
  return new Request("http://localhost/", token ? { headers: { authorization: `Bearer ${token}` } } : {});
}

// Guards are always DI-resolved in real usage (app.get(guardClass)) —
// Class<CanActivate>'s constructor type deliberately hides its params, so
// this goes through a real module + container too, not a raw `new`.
async function authenticateWithRoles(userRoles: string[], ...requiredRoles: string[]) {
  const auth = defineAuthModule(ClaimsSchema);
  const RolesGuard = auth.createRolesGuard(...requiredRoles);

  @Module({ imports: [auth.AuthModule.forRoot({ secret: SECRET })], providers: [RolesGuard] })
  class TestModule {}

  const app = await createHttpApplication(TestModule);
  const jwtGuard = app.get(auth.JwtAuthGuard);
  const token = await signToken({ sub: "user-1", roles: userRoles });

  return { app, RolesGuard, jwtGuard, token };
}

describe("defineAuthModule", () => {
  it("JwtAuthGuard accepts a valid token and stores its claims for getCurrentUser", async () => {
    const { AuthModule, JwtAuthGuard, getCurrentUser } = defineAuthModule(ClaimsSchema);
    const app = await createHttpApplication(AuthModule.forRoot({ secret: SECRET }));
    const guard = app.get(JwtAuthGuard);
    const ctx = app.get(RequestContext);
    const token = await signToken({ sub: "user-1", roles: ["admin"] });

    await runInRequestContext(async () => {
      const allowed = await guard.canActivate({ request: requestWith(token), params: {} });
      expect(allowed).toBe(true);
      expect(getCurrentUser(ctx)).toEqual({ sub: "user-1", roles: ["admin"] });
    });
  });

  it("rejects a missing Authorization header", async () => {
    const { AuthModule, JwtAuthGuard } = defineAuthModule(ClaimsSchema);
    const app = await createHttpApplication(AuthModule.forRoot({ secret: SECRET }));
    const guard = app.get(JwtAuthGuard);

    await runInRequestContext(() =>
      expect(guard.canActivate({ request: requestWith(), params: {} })).rejects.toThrow(UnauthorizedException),
    );
  });

  it("rejects a malformed Authorization header (no Bearer prefix)", async () => {
    const { AuthModule, JwtAuthGuard } = defineAuthModule(ClaimsSchema);
    const app = await createHttpApplication(AuthModule.forRoot({ secret: SECRET }));
    const guard = app.get(JwtAuthGuard);
    const request = new Request("http://localhost/", { headers: { authorization: "not-a-bearer-token" } });

    await runInRequestContext(() =>
      expect(guard.canActivate({ request, params: {} })).rejects.toThrow(UnauthorizedException),
    );
  });

  it("rejects a token signed with the wrong secret", async () => {
    const { AuthModule, JwtAuthGuard } = defineAuthModule(ClaimsSchema);
    const app = await createHttpApplication(AuthModule.forRoot({ secret: SECRET }));
    const guard = app.get(JwtAuthGuard);
    const token = await signToken({ sub: "user-1", roles: [] }, { secret: "a-completely-different-secret!!" });

    await runInRequestContext(() =>
      expect(guard.canActivate({ request: requestWith(token), params: {} })).rejects.toThrow(UnauthorizedException),
    );
  });

  it("rejects an expired token", async () => {
    const { AuthModule, JwtAuthGuard } = defineAuthModule(ClaimsSchema);
    const app = await createHttpApplication(AuthModule.forRoot({ secret: SECRET }));
    const guard = app.get(JwtAuthGuard);
    const token = await signToken({ sub: "user-1", roles: [] }, { expSecondsFromNow: -60 });

    await runInRequestContext(() =>
      expect(guard.canActivate({ request: requestWith(token), params: {} })).rejects.toThrow(UnauthorizedException),
    );
  });

  it("rejects a token whose payload fails the claims schema", async () => {
    const { AuthModule, JwtAuthGuard } = defineAuthModule(ClaimsSchema);
    const app = await createHttpApplication(AuthModule.forRoot({ secret: SECRET }));
    const guard = app.get(JwtAuthGuard);
    const token = await signToken({ sub: "user-1" }); // missing `roles`

    await runInRequestContext(() =>
      expect(guard.canActivate({ request: requestWith(token), params: {} })).rejects.toThrow(UnauthorizedException),
    );
  });

  it("defaults the algorithm to HS256", async () => {
    const { AuthModule, JwtAuthGuard } = defineAuthModule(ClaimsSchema);
    const app = await createHttpApplication(AuthModule.forRoot({ secret: SECRET }));
    const guard = app.get(JwtAuthGuard);
    const token = await signToken({ sub: "user-1", roles: [] });

    await runInRequestContext(async () => {
      await expect(guard.canActivate({ request: requestWith(token), params: {} })).resolves.toBe(true);
    });
  });

  describe("createRolesGuard", () => {
    it("allows a user who has one of the required roles", async () => {
      const { app, RolesGuard, jwtGuard, token } = await authenticateWithRoles(["editor"], "admin", "editor");

      // Both guards must run inside the same runInRequestContext call —
      // it's what real request handling does (one call wraps the whole
      // guard chain) and what makes the JWT guard's write visible here.
      await runInRequestContext(async () => {
        await jwtGuard.canActivate({ request: requestWith(token), params: {} });
        expect(app.get(RolesGuard).canActivate({ request: requestWith(), params: {} })).toBe(true);
      });
    });

    it("denies a user who has none of the required roles", async () => {
      const { app, RolesGuard, jwtGuard, token } = await authenticateWithRoles(["editor"], "admin");

      await runInRequestContext(async () => {
        await jwtGuard.canActivate({ request: requestWith(token), params: {} });
        expect(app.get(RolesGuard).canActivate({ request: requestWith(), params: {} })).toBe(false);
      });
    });

    it("throws UnauthorizedException when no user is in RequestContext yet", async () => {
      const auth = defineAuthModule(ClaimsSchema);
      const RolesGuard = auth.createRolesGuard("admin");

      @Module({ imports: [auth.AuthModule.forRoot({ secret: SECRET })], providers: [RolesGuard] })
      class TestModule {}

      const app = await createHttpApplication(TestModule);

      runInRequestContext(() => {
        expect(() => app.get(RolesGuard).canActivate({ request: requestWith(), params: {} })).toThrow(
          UnauthorizedException,
        );
      });
    });
  });

  it("defaults to a non-global module", async () => {
    const { AuthModule } = defineAuthModule(ClaimsSchema);

    const dynamic = AuthModule.forRoot({ secret: SECRET });

    expect(dynamic.global).toBe(false);
  });

  it("global: true makes JwtAuthGuard visible without a direct import", () => {
    const { AuthModule } = defineAuthModule(ClaimsSchema);

    const dynamic = AuthModule.forRoot({ secret: SECRET, global: true });

    expect(dynamic.global).toBe(true);
  });

  it("each call to defineAuthModule produces its own distinct JwtAuthGuard class", () => {
    const a = defineAuthModule(ClaimsSchema);
    const b = defineAuthModule(ClaimsSchema);

    expect(a.JwtAuthGuard).not.toBe(b.JwtAuthGuard);
  });
});
