import { Module } from "@blixis-io/core";
import { Controller, Get, Post, Req, createHttpApplication } from "@blixis-io/http";
import { afterEach, describe, expect, it } from "vitest";
import { serializeCookie } from "./cookies.example.js";
import { cookieToBearer, originCheck } from "./csrf.example.js";

// Through the real application and a real socket: what a browser would send, with the headers a browser sets.

const calls: string[] = [];

@Controller("things")
class ThingsController {
  @Get()
  read() {
    calls.push("GET");
    return { ok: true };
  }

  @Post()
  change() {
    calls.push("POST");
    return { ok: true };
  }

  /** Echoes what the application sees as the credential. */
  @Get("credential")
  credential(@Req() request: Request) {
    return { authorization: request.headers.get("authorization") };
  }

  /** Sets two cookies in one response, the way a sign-in sets a session and a refresh cookie. */
  @Post("sign-in")
  signIn() {
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", serializeCookie("__Host-access", "access-token", { maxAge: 900, sameSite: "Strict" }));
    headers.append("set-cookie", serializeCookie("__Secure-refresh", "refresh-token", { maxAge: 86_400, path: "/auth", sameSite: "Strict" }));
    return new Response(JSON.stringify({ ok: true }), { headers });
  }
}

@Module({ controllers: [ThingsController] })
class TestModule {}

const opened: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((app) => app.close()));
  calls.length = 0;
});

async function boot(trustedOrigins: string[] = []) {
  const app = await createHttpApplication(TestModule, { middleware: [originCheck({ trustedOrigins }), cookieToBearer({ cookie: "__Host-access" })] });
  const { port } = await app.listen(0, "127.0.0.1");
  opened.push(app);
  return { host: `127.0.0.1:${port}`, url: (path: string) => `http://127.0.0.1:${port}${path}` };
}

describe("originCheck", () => {
  it("lets reads through whatever site they came from (a read must never change anything)", async () => {
    const { url } = await boot();

    const response = await fetch(url("/things"), { headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" } });

    expect(response.status).toBe(200);
  });

  it.each([
    ["cross-site", { "sec-fetch-site": "cross-site", origin: "https://evil.example" }],
    ["same-site (a sibling subdomain, which may be someone else's)", { "sec-fetch-site": "same-site", origin: "https://other.example.com" }],
    ["cross-site with no Origin header", { "sec-fetch-site": "cross-site" }],
    ["an older browser, another origin", { origin: "https://evil.example" }],
    ["an older browser, the opaque origin", { origin: "null" }],
    ["an older browser, an unparseable origin", { origin: "not a url" }],
    ["an older browser, the same host but another port", { origin: "http://127.0.0.1:1" }],
  ])("refuses a state change that is %s, and the application never runs", async (_label, headers) => {
    const { url } = await boot();

    const response = await fetch(url("/things"), { method: "POST", headers });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ detail: "Cross-origin request refused" });
    expect(calls).toEqual([]);
  });

  it("lets a state change through when the browser says same-origin or none (a bookmark, a typed address)", async () => {
    const { url } = await boot();

    expect((await fetch(url("/things"), { method: "POST", headers: { "sec-fetch-site": "same-origin" } })).status).toBe(200);
    expect((await fetch(url("/things"), { method: "POST", headers: { "sec-fetch-site": "none" } })).status).toBe(200);
  });

  it("lets a request that is not from a browser through: no Sec-Fetch-Site and no Origin", async () => {
    const { url } = await boot();

    expect((await fetch(url("/things"), { method: "POST" })).status).toBe(200);
  });

  it("lets an older browser through when the origin is the host it asked", async () => {
    const { url, host } = await boot();

    expect((await fetch(url("/things"), { method: "POST", headers: { origin: `http://${host}` } })).status).toBe(200);
  });

  it("lets a trusted origin through even though it is cross-site, and only that one", async () => {
    const { url } = await boot(["https://app.example.com"]);

    const trusted = await fetch(url("/things"), { method: "POST", headers: { "sec-fetch-site": "cross-site", origin: "https://app.example.com" } });
    const other = await fetch(url("/things"), { method: "POST", headers: { "sec-fetch-site": "cross-site", origin: "https://app.example.com.evil.example" } });

    expect(trusted.status).toBe(200);
    expect(other.status).toBe(403);
  });

  it("refuses a trusted origin that is not an origin, when it is configured", () => {
    expect(() => originCheck({ trustedOrigins: ["*"] })).toThrow("not an origin");
    expect(() => originCheck({ trustedOrigins: ["app.example.com"] })).toThrow("not an origin");
    expect(() => originCheck({ trustedOrigins: ["https://app.example.com/path"] })).toThrow("not an origin");
    expect(() => originCheck({ trustedOrigins: ["https://app.example.com/"] })).not.toThrow();
  });
});

describe("cookieToBearer", () => {
  it("turns the named cookie into the bearer token the application sees", async () => {
    const { url } = await boot();

    const response = await fetch(url("/things/credential"), { headers: { cookie: "other=1; __Host-access=the-token" } });

    expect(await response.json()).toEqual({ authorization: "Bearer the-token" });
  });

  it("never overrides an Authorization header that was sent", async () => {
    const { url } = await boot();

    const response = await fetch(url("/things/credential"), { headers: { cookie: "__Host-access=from-cookie", authorization: "Bearer explicit" } });

    expect(await response.json()).toEqual({ authorization: "Bearer explicit" });
  });

  it("does nothing without the cookie, with an empty one, or with a cookie of another name", async () => {
    const { url } = await boot();

    for (const cookie of [undefined, "__Host-access=", "access=nope"]) {
      const response = await fetch(url("/things/credential"), { headers: cookie === undefined ? {} : { cookie } });
      expect(await response.json()).toEqual({ authorization: null });
    }
  });

  it("runs after the origin check: a cross-site request carrying the cookie is refused before it becomes a credential", async () => {
    const { url } = await boot();

    const response = await fetch(url("/things"), { method: "POST", headers: { cookie: "__Host-access=the-token", "sec-fetch-site": "cross-site", origin: "https://evil.example" } });

    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe("Set-Cookie through the Node adapter", () => {
  it("sends two cookies as two headers, not one folded value", async () => {
    const { url } = await boot();

    const response = await fetch(url("/things/sign-in"), { method: "POST" });

    expect(response.headers.getSetCookie()).toEqual([
      "__Host-access=access-token; Path=/; Max-Age=900; Secure; HttpOnly; SameSite=Strict",
      "__Secure-refresh=refresh-token; Path=/auth; Max-Age=86400; Secure; HttpOnly; SameSite=Strict",
    ]);
  });
});
