import { Module } from "@blixis-io/core";
import { Controller, createHttpApplication, Get, RequestContext, UseGuards } from "@blixis-io/http";
import { createIpMatcher } from "@blixis-io/security";
import { SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { generateApiKey, type ApiKeyRecord, type ApiKeyStore } from "./api-keys.js";
import { Public, RequireScopes, Roles, defineAuthModule } from "./module.js";

const SECRET = "test-secret-at-least-32-bytes-long!!";
const ClaimsSchema = z.object({ sub: z.string(), roles: z.array(z.string()) });

const records = new Map<string, ApiKeyRecord>();
const lookups: string[] = [];

/** A store over a map, as a DI class, the way an application's would be over its database. */
class MapStore implements ApiKeyStore {
  async find(id: string) {
    lookups.push(id);
    return records.get(id);
  }
}

function addKey(overrides: Partial<ApiKeyRecord> = {}): string {
  const made = generateApiKey();
  records.set(made.id, { id: made.id, secretHash: made.secretHash, claims: { sub: "service-1", roles: ["reader"] }, scopes: ["read"], ...overrides });
  return made.key;
}

const auth = defineAuthModule(ClaimsSchema);

@Controller("things")
class ThingsController {
  constructor(private readonly ctx: RequestContext) {}

  @Get("whoami")
  whoami() {
    return { user: auth.getCurrentUser(this.ctx), key: auth.getCurrentApiKey(this.ctx) ?? null };
  }

  @Get("admin")
  @Roles("admin")
  admin() {
    return { ok: true };
  }

  @Get("open")
  @Public()
  open() {
    return { open: true };
  }
}

@Controller("scoped")
@RequireScopes("read")
class ScopedController {
  /** Inherits the controller's scope. */
  @Get("read")
  read() {
    return { ok: true };
  }

  /** Replaces the controller's scope with its own. */
  @Get("write")
  @RequireScopes("write")
  write() {
    return { ok: true };
  }

  @Get("both")
  @RequireScopes("read", "write")
  both() {
    return { ok: true };
  }
}

@Controller("jwt-only")
@UseGuards(auth.JwtAuthGuard)
class JwtOnlyController {
  @Get()
  get() {
    return { ok: true };
  }
}

async function boot(options: { apiKeys?: boolean; scopedRoutesOnly?: boolean; clientIp?: { trustedProxyHops?: number; isTrustedProxy?: (peer: string) => boolean } } = {}) {
  @Module({
    imports: [
      auth.AuthModule.forRoot({
        secret: SECRET,
        protectAllRoutes: true,
        ...(options.apiKeys === false ? {} : { apiKeys: { store: MapStore, scopedRoutesOnly: options.scopedRoutesOnly, ...(options.clientIp ? { clientIp: options.clientIp } : {}) } }),
      }),
    ],
    controllers: [ThingsController, ScopedController, JwtOnlyController],
  })
  class TestModule {}
  const app = await createHttpApplication(TestModule);
  const { port } = await app.listen(0, "127.0.0.1");
  opened.push(app);
  return { app, url: (path: string) => `http://127.0.0.1:${port}/${/^(scoped|jwt-only|things)(\/|$)/.test(path) ? "" : "things/"}${path}` };
}

const opened: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((app) => app.close()));
  records.clear();
  lookups.length = 0;
});

const token = (claims: Record<string, unknown>) =>
  new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(SECRET));

describe("apiKeys in the auth module", () => {
  it("authenticates a route with a key, as the claims the store holds, and says which key", async () => {
    const { url } = await boot();
    const key = addKey({ claims: { sub: "billing-service", roles: ["reader"] }, scopes: ["invoices:read"] });

    const response = await fetch(url("whoami"), { headers: { "x-api-key": key } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: { sub: "billing-service", roles: ["reader"] },
      key: { id: key.split("_")[1], scopes: ["invoices:read"] },
    });
  });

  it("enforces @Roles from the key's claims, exactly as for a token", async () => {
    const { url } = await boot();
    const reader = addKey({ claims: { sub: "r", roles: ["reader"] } });
    const admin = addKey({ claims: { sub: "a", roles: ["admin"] } });

    expect((await fetch(url("admin"), { headers: { "x-api-key": reader } })).status).toBe(403);
    expect((await fetch(url("admin"), { headers: { "x-api-key": admin } })).status).toBe(200);
  });

  it("still accepts a bearer token on the same routes, and it has no api key", async () => {
    const { url } = await boot();

    const response = await fetch(url("whoami"), { headers: { authorization: `Bearer ${await token({ sub: "u", roles: [] })}` } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: { sub: "u", roles: [] }, key: null });
  });

  it("is a 401 for a route with neither, and the bare Bearer challenge it always had", async () => {
    const { url } = await boot();

    const response = await fetch(url("whoami"));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("never falls back to the token when a key is presented and is bad", async () => {
    const { url } = await boot();
    const valid = await token({ sub: "u", roles: ["admin"] });

    const response = await fetch(url("admin"), { headers: { "x-api-key": generateApiKey().key, authorization: `Bearer ${valid}` } });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ detail: "Invalid API key" });
  });

  it("does not look at the token when a good key is presented", async () => {
    const { url } = await boot();
    const key = addKey({ claims: { sub: "svc", roles: ["reader"] } });

    const response = await fetch(url("whoami"), { headers: { "x-api-key": key, authorization: "Bearer not-even-a-token" } });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { sub: "svc" } });
  });

  it("leaves @Public() routes open, with or without a key", async () => {
    const { url } = await boot();

    expect((await fetch(url("open"))).status).toBe(200);
    expect((await fetch(url("open"), { headers: { "x-api-key": "garbage" } })).status).toBe(200);
  });

  it("ignores x-api-key entirely when apiKeys is not configured", async () => {
    const { url } = await boot({ apiKeys: false });
    const key = addKey();

    const response = await fetch(url("whoami"), { headers: { "x-api-key": key } });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(lookups).toEqual([]);
  });

  it("refuses a revoked key at once, and an unknown one the same way", async () => {
    const { url } = await boot();
    const key = addKey({ revokedAt: new Date(Date.now() - 1000) });

    const revoked = await fetch(url("whoami"), { headers: { "x-api-key": key } });
    const unknown = await fetch(url("whoami"), { headers: { "x-api-key": generateApiKey().key } });

    expect(revoked.status).toBe(401);
    expect(await revoked.text()).toBe(await unknown.text());
  });

  describe("allowedCidrs, through a real socket", () => {
    it("accepts the connecting address when it is inside, and refuses it when it is not", async () => {
      const { url } = await boot();
      const inside = addKey({ allowedCidrs: ["127.0.0.0/8"] });
      const outside = addKey({ allowedCidrs: ["203.0.113.0/24"] });

      expect((await fetch(url("whoami"), { headers: { "x-api-key": inside } })).status).toBe(200);
      expect((await fetch(url("whoami"), { headers: { "x-api-key": outside } })).status).toBe(401);
    });

    it("ignores X-Forwarded-For unless a proxy is trusted: a client cannot claim an allowed address", async () => {
      const { url } = await boot();
      const key = addKey({ allowedCidrs: ["203.0.113.0/24"] });

      const response = await fetch(url("whoami"), { headers: { "x-api-key": key, "x-forwarded-for": "203.0.113.9" } });

      expect(response.status).toBe(401);
    });

    it("reads the address the proxy wrote when it is told how many proxies there are, and never the part a client can forge", async () => {
      const { url } = await boot({ clientIp: { trustedProxyHops: 1, isTrustedProxy: createIpMatcher(["127.0.0.0/8"]) } });
      const key = addKey({ allowedCidrs: ["203.0.113.0/24"] });

      const proxied = await fetch(url("whoami"), { headers: { "x-api-key": key, "x-forwarded-for": "203.0.113.9" } });
      const forged = await fetch(url("whoami"), { headers: { "x-api-key": key, "x-forwarded-for": "203.0.113.9, 198.51.100.4" } });

      expect(proxied.status).toBe(200);
      expect(forged.status).toBe(401); // the last entry is the one the proxy wrote; the left is the client's
    });
  });
});

const get = (url: string, key: string) => fetch(url, { headers: { "x-api-key": key } });

describe("RequireScopes", () => {
  it("lets a key through only when it holds the scope, and says 403 (not 401) when it does not", async () => {
    const { url } = await boot();
    const reader = addKey({ scopes: ["read"] });
    const nothing = addKey({ scopes: [] });

    expect((await get(url("scoped/read"), reader)).status).toBe(200);
    expect((await get(url("scoped/read"), nothing)).status).toBe(403);
  });

  it("a route's own scope replaces the controller's, it does not add to it", async () => {
    const { url } = await boot();
    const reader = addKey({ scopes: ["read"] });
    const writer = addKey({ scopes: ["write"] });

    expect((await get(url("scoped/write"), reader)).status).toBe(403);
    expect((await get(url("scoped/write"), writer)).status).toBe(200);
    expect((await get(url("scoped/read"), writer)).status).toBe(403); // the controller's `read`, which this key lacks
  });

  it("requires all of several scopes, not any", async () => {
    const { url } = await boot();

    expect((await get(url("scoped/both"), addKey({ scopes: ["read"] }))).status).toBe(403);
    expect((await get(url("scoped/both"), addKey({ scopes: ["write"] }))).status).toBe(403);
    expect((await get(url("scoped/both"), addKey({ scopes: ["write", "read", "extra"] }))).status).toBe(200);
  });

  it("does not apply to a request authenticated with a token", async () => {
    const { url } = await boot();

    const response = await fetch(url("scoped/both"), { headers: { authorization: `Bearer ${await token({ sub: "u", roles: [] })}` } });

    expect(response.status).toBe(200);
  });

  it("leaves a key alone on a route without scopes by default", async () => {
    const { url } = await boot();

    expect((await get(url("things/whoami"), addKey({ scopes: [] }))).status).toBe(200);
  });

  it("scopedRoutesOnly refuses a key on a route that does not say what it needs, and nothing else", async () => {
    const { url } = await boot({ scopedRoutesOnly: true });
    const key = addKey({ scopes: ["read", "write"] });
    const jwt = { authorization: `Bearer ${await token({ sub: "u", roles: [] })}` };

    expect((await get(url("things/whoami"), key)).status).toBe(403); // unannotated
    expect((await get(url("scoped/read"), key)).status).toBe(200); // annotated
    expect((await fetch(url("things/whoami"), { headers: jwt })).status).toBe(200); // a token is not a key
    expect((await fetch(url("things/open"), { headers: { "x-api-key": key } })).status).toBe(200); // public stays public
  });
});

describe("JwtAuthGuard", () => {
  it("accepts tokens only: a key cannot get in through a guard that does not check scopes", async () => {
    const { url } = await boot();
    const key = addKey({ scopes: ["read", "write"] });

    const withKey = await fetch(url("jwt-only"), { headers: { "x-api-key": key } });
    const withToken = await fetch(url("jwt-only"), { headers: { authorization: `Bearer ${await token({ sub: "u", roles: [] })}` } });

    expect(withKey.status).toBe(401);
    expect(withToken.status).toBe(200);
  });
});

describe("forRoot validation", () => {
  it("refuses a negative cache time at boot", () => {
    expect(() => auth.AuthModule.forRoot({ secret: SECRET, apiKeys: { store: MapStore, cacheSeconds: -1 } })).toThrow(/cacheSeconds/);
    expect(() => auth.AuthModule.forRoot({ secret: SECRET, apiKeys: { store: MapStore, lastUsedIntervalSeconds: Number.NaN } })).toThrow(/lastUsedIntervalSeconds/);
  });
});
