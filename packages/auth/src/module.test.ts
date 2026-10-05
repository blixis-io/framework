import { Module } from "@blixis-io/core";
import { createHttpApplication, RequestContext, runInRequestContext, UnauthorizedException } from "@blixis-io/http";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AuthConfigError, defineAuthModule } from "./module.js";

/** The controller every hand-built ExecutionContext in this file points at. */
class TestController {}

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
      const allowed = await guard.canActivate({ request: requestWith(token), params: {}, controller: TestController, handler: "route" });
      expect(allowed).toBe(true);
      expect(getCurrentUser(ctx)).toEqual({ sub: "user-1", roles: ["admin"] });
    });
  });

  it("rejects a missing Authorization header", async () => {
    const { AuthModule, JwtAuthGuard } = defineAuthModule(ClaimsSchema);
    const app = await createHttpApplication(AuthModule.forRoot({ secret: SECRET }));
    const guard = app.get(JwtAuthGuard);

    await runInRequestContext(() =>
      expect(guard.canActivate({ request: requestWith(), params: {}, controller: TestController, handler: "route" })).rejects.toThrow(UnauthorizedException),
    );
  });

  it("rejects a malformed Authorization header (no Bearer prefix)", async () => {
    const { AuthModule, JwtAuthGuard } = defineAuthModule(ClaimsSchema);
    const app = await createHttpApplication(AuthModule.forRoot({ secret: SECRET }));
    const guard = app.get(JwtAuthGuard);
    const request = new Request("http://localhost/", { headers: { authorization: "not-a-bearer-token" } });

    await runInRequestContext(() =>
      expect(guard.canActivate({ request, params: {}, controller: TestController, handler: "route" })).rejects.toThrow(UnauthorizedException),
    );
  });

  it("rejects a token signed with the wrong secret", async () => {
    const { AuthModule, JwtAuthGuard } = defineAuthModule(ClaimsSchema);
    const app = await createHttpApplication(AuthModule.forRoot({ secret: SECRET }));
    const guard = app.get(JwtAuthGuard);
    const token = await signToken({ sub: "user-1", roles: [] }, { secret: "a-completely-different-secret!!" });

    await runInRequestContext(() =>
      expect(guard.canActivate({ request: requestWith(token), params: {}, controller: TestController, handler: "route" })).rejects.toThrow(UnauthorizedException),
    );
  });

  it("rejects an expired token", async () => {
    const { AuthModule, JwtAuthGuard } = defineAuthModule(ClaimsSchema);
    const app = await createHttpApplication(AuthModule.forRoot({ secret: SECRET }));
    const guard = app.get(JwtAuthGuard);
    const token = await signToken({ sub: "user-1", roles: [] }, { expSecondsFromNow: -60 });

    await runInRequestContext(() =>
      expect(guard.canActivate({ request: requestWith(token), params: {}, controller: TestController, handler: "route" })).rejects.toThrow(UnauthorizedException),
    );
  });

  it("rejects a token whose payload fails the claims schema", async () => {
    const { AuthModule, JwtAuthGuard } = defineAuthModule(ClaimsSchema);
    const app = await createHttpApplication(AuthModule.forRoot({ secret: SECRET }));
    const guard = app.get(JwtAuthGuard);
    const token = await signToken({ sub: "user-1" }); // missing `roles`

    await runInRequestContext(() =>
      expect(guard.canActivate({ request: requestWith(token), params: {}, controller: TestController, handler: "route" })).rejects.toThrow(UnauthorizedException),
    );
  });

  it("defaults the algorithm to HS256", async () => {
    const { AuthModule, JwtAuthGuard } = defineAuthModule(ClaimsSchema);
    const app = await createHttpApplication(AuthModule.forRoot({ secret: SECRET }));
    const guard = app.get(JwtAuthGuard);
    const token = await signToken({ sub: "user-1", roles: [] });

    await runInRequestContext(async () => {
      await expect(guard.canActivate({ request: requestWith(token), params: {}, controller: TestController, handler: "route" })).resolves.toBe(true);
    });
  });

  describe("createRolesGuard", () => {
    it("allows a user who has one of the required roles", async () => {
      const { app, RolesGuard, jwtGuard, token } = await authenticateWithRoles(["editor"], "admin", "editor");

      // Both guards must run inside the same runInRequestContext call —
      // it's what real request handling does (one call wraps the whole
      // guard chain) and what makes the JWT guard's write visible here.
      await runInRequestContext(async () => {
        await jwtGuard.canActivate({ request: requestWith(token), params: {}, controller: TestController, handler: "route" });
        expect(app.get(RolesGuard).canActivate({ request: requestWith(), params: {}, controller: TestController, handler: "route" })).toBe(true);
      });
    });

    it("denies a user who has none of the required roles", async () => {
      const { app, RolesGuard, jwtGuard, token } = await authenticateWithRoles(["editor"], "admin");

      await runInRequestContext(async () => {
        await jwtGuard.canActivate({ request: requestWith(token), params: {}, controller: TestController, handler: "route" });
        expect(app.get(RolesGuard).canActivate({ request: requestWith(), params: {}, controller: TestController, handler: "route" })).toBe(false);
      });
    });

    it("throws UnauthorizedException when no user is in RequestContext yet", async () => {
      const auth = defineAuthModule(ClaimsSchema);
      const RolesGuard = auth.createRolesGuard("admin");

      @Module({ imports: [auth.AuthModule.forRoot({ secret: SECRET })], providers: [RolesGuard] })
      class TestModule {}

      const app = await createHttpApplication(TestModule);

      runInRequestContext(() => {
        expect(() => app.get(RolesGuard).canActivate({ request: requestWith(), params: {}, controller: TestController, handler: "route" })).toThrow(
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

/** The `WWW-Authenticate` value an `UnauthorizedException` carries, or undefined for anything else. */
function challengeOf(error: unknown): string | undefined {
  return error instanceof UnauthorizedException ? error.headers?.["www-authenticate"] : undefined;
}

const forRootWith = (secret: string, algorithm?: "HS256" | "HS384" | "HS512") =>
  defineAuthModule(ClaimsSchema).AuthModule.forRoot({ secret, ...(algorithm ? { algorithm } : {}) });

async function headerOutcome(header: string | undefined) {
  const { AuthModule, JwtAuthGuard } = defineAuthModule(ClaimsSchema);
  const app = await createHttpApplication(AuthModule.forRoot({ secret: SECRET }));
  const guard = app.get(JwtAuthGuard);
  const request = new Request("http://localhost/", header === undefined ? {} : { headers: { authorization: header } });
  return runInRequestContext(async () => {
    try {
      return { allowed: await guard.canActivate({ request, params: {}, controller: TestController, handler: "route" }) };
    } catch (error) {
      return { error };
    }
  });
}

describe("AuthModule.forRoot: the secret must be strong enough for the algorithm", () => {
  it("accepts the minimum for each algorithm, in bytes: 32 for HS256, 48 for HS384, 64 for HS512", () => {
    expect(() => forRootWith("a".repeat(32))).not.toThrow();
    expect(() => forRootWith("a".repeat(32), "HS256")).not.toThrow();
    expect(() => forRootWith("a".repeat(48), "HS384")).not.toThrow();
    expect(() => forRootWith("a".repeat(64), "HS512")).not.toThrow();
  });

  it.each([
    ["an empty secret", "", undefined],
    ["a short word", "secret", undefined],
    ["one byte under HS256's minimum", "a".repeat(31), "HS256"],
    ["a 32-byte secret for HS384", "a".repeat(32), "HS384"],
    ["a 47-byte secret for HS384", "a".repeat(47), "HS384"],
    ["a 48-byte secret for HS512", "a".repeat(48), "HS512"],
    ["a 63-byte secret for HS512", "a".repeat(63), "HS512"],
  ] as const)("refuses %s at boot, before any token could be signed or verified with it", (_label, secret, algorithm) => {
    expect(() => forRootWith(secret, algorithm)).toThrow(AuthConfigError);
  });

  it("counts bytes, not characters: 16 two-byte characters are 32 bytes", () => {
    expect(() => forRootWith("é".repeat(16))).not.toThrow();
    expect(() => forRootWith("é".repeat(15))).toThrow(AuthConfigError);
  });

  it("says what is wrong and how to fix it, without printing the secret", () => {
    const secret = "hunter2-hunter2";

    let message = "";
    try {
      forRootWith(secret);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toContain("HS256");
    expect(message).toContain("32 bytes");
    expect(message).toContain(`${secret.length} bytes`);
    expect(message).toContain("openssl rand");
    expect(message).not.toContain(secret);
  });
});

describe("JwtAuthGuard: what a token must carry", () => {
  const key = new TextEncoder().encode(SECRET);

  async function verdict(token: string, options: Parameters<ReturnType<typeof defineAuthModule<typeof ClaimsSchema>>["AuthModule"]["forRoot"]>[0] = { secret: SECRET }) {
    const { AuthModule, JwtAuthGuard } = defineAuthModule(ClaimsSchema);
    const app = await createHttpApplication(AuthModule.forRoot(options));
    const guard = app.get(JwtAuthGuard);
    return runInRequestContext(async () => {
      try {
        return { allowed: await guard.canActivate({ request: requestWith(token), params: {}, controller: TestController, handler: "route" }) };
      } catch (error) {
        return { error };
      }
    });
  }

  const claims = { sub: "user-1", roles: [] };
  const sign = (build: (jwt: SignJWT) => SignJWT) => build(new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt()).sign(key);

  it("rejects a token that never expires, even with a valid signature", async () => {
    const result = await verdict(await sign((jwt) => jwt));

    expect(result.error).toBeInstanceOf(UnauthorizedException);
    expect(challengeOf(result.error)).toBe('Bearer error="invalid_token"');
  });

  it("still accepts a token that has an expiry in the future", async () => {
    expect((await verdict(await sign((jwt) => jwt.setExpirationTime("1h")))).allowed).toBe(true);
  });

  describe("with an issuer configured", () => {
    const options = { secret: SECRET, issuer: "https://auth.example.com" };

    it("accepts a token from that issuer", async () => {
      expect((await verdict(await sign((jwt) => jwt.setExpirationTime("1h").setIssuer("https://auth.example.com")), options)).allowed).toBe(true);
    });

    it.each([
      ["another issuer", (jwt: SignJWT) => jwt.setIssuer("https://staging.example.com")],
      ["no issuer", (jwt: SignJWT) => jwt],
    ])("rejects a token with %s, though signed with the same secret", async (_label, build) => {
      const result = await verdict(await sign((jwt) => build(jwt.setExpirationTime("1h"))), options);

      expect(result.error).toBeInstanceOf(UnauthorizedException);
    });
  });

  describe("with an audience configured", () => {
    const options = { secret: SECRET, audience: "orders-api" };

    it("accepts a token for that audience, including when the token lists several", async () => {
      expect((await verdict(await sign((jwt) => jwt.setExpirationTime("1h").setAudience("orders-api")), options)).allowed).toBe(true);
      expect((await verdict(await sign((jwt) => jwt.setExpirationTime("1h").setAudience(["billing-api", "orders-api"])), options)).allowed).toBe(true);
    });

    it.each([
      ["another audience", (jwt: SignJWT) => jwt.setAudience("billing-api")],
      ["no audience", (jwt: SignJWT) => jwt],
    ])("rejects a token with %s", async (_label, build) => {
      const result = await verdict(await sign((jwt) => build(jwt.setExpirationTime("1h"))), options);

      expect(result.error).toBeInstanceOf(UnauthorizedException);
    });
  });

  it("does not look at issuer or audience when none is configured", async () => {
    const token = await sign((jwt) => jwt.setExpirationTime("1h").setIssuer("anyone").setAudience("anything"));

    expect((await verdict(token)).allowed).toBe(true);
  });
});

describe("JwtAuthGuard: the Authorization header", () => {
  it.each(["Bearer", "bearer", "BEARER", "BeArEr"])("accepts the scheme written as %s (RFC 7235: case-insensitive)", async (scheme) => {
    expect((await headerOutcome(`${scheme} ${await signToken({ sub: "u", roles: [] })}`)).allowed).toBe(true);
  });

  it("accepts more than one space between the scheme and the token", async () => {
    expect((await headerOutcome(`Bearer    ${await signToken({ sub: "u", roles: [] })}`)).allowed).toBe(true);
  });

  it.each([
    ["no header at all", undefined],
    ["the scheme with no token", "Bearer"],
    ["the scheme with only spaces after it", "Bearer   "],
    ["another scheme", "Basic dXNlcjpwYXNz"],
    ["a token with a space inside it", "Bearer abc def"],
    ["the scheme glued to the token", "Bearerabc"],
  ])("answers 401 with the bare Bearer challenge for %s", async (_label, header) => {
    const result = await headerOutcome(header);

    expect(result.error).toBeInstanceOf(UnauthorizedException);
    expect(challengeOf(result.error)).toBe("Bearer");
  });
});
