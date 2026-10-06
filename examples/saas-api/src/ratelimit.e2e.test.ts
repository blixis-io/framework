import { describe, expect, it } from "vitest";
import { PASSWORD, startApp, TEST_ORIGIN, uniqueEmail } from "./test-support.js";

// Its own file on purpose: several applications run side by side here, and each file gets its own module state.

/** Real sockets and a trusted proxy, so each test names its own client address and never shares a counter. */
async function limited(env: Record<string, string>) {
  const started = await startApp({ TRUSTED_PROXY_HOPS: "1", ...env });
  const { port } = await started.app.listen(0, "127.0.0.1");
  return { ...started, url: `http://127.0.0.1:${port}` };
}
/** A fresh documentation-range IPv6 address per call (65 536 x 65 536 of them), so no two tests ever share a counter, even run again within the minute. */
const address = () => `2001:db8:${Math.floor(Math.random() * 0x10000).toString(16)}::${Math.floor(Math.random() * 0x10000).toString(16)}`;
/** A client as a proxy reports it: whatever the client wrote first, then the address the proxy saw. */
const client = () => `203.0.113.7, ${address()}`;
const signIn = (url: string, forwardedFor: string, email = uniqueEmail("nobody")) =>
  fetch(`${url}/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": forwardedFor }, body: JSON.stringify({ email, password: PASSWORD }) });


describe("rate limiting", () => {
  it("throttles sign-in strictly per client, answering 429 with Retry-After and the CORS headers, and leaves other clients alone", async () => {
    const app = await limited({ AUTH_RATE_LIMIT_PER_MINUTE: "3" });
    const mine = client();
    const yours = client();

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      statuses.push((await signIn(app.url, mine)).status);
    }
    const blocked = await fetch(`${app.url}/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": mine, origin: TEST_ORIGIN },
      body: JSON.stringify({ email: uniqueEmail(), password: PASSWORD }),
    });

    expect(statuses).toEqual([401, 401, 401, 429, 429]); // wrong credentials, three allowed attempts, then refused
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(blocked.headers.get("access-control-allow-origin")).toBe(TEST_ORIGIN);
    expect(blocked.headers.get("content-type")).toBe("application/problem+json");
    expect((await signIn(app.url, yours)).status).toBe(401); // a different client has its own budget
    await app.close();
  });

  it("reads the client from the end of X-Forwarded-For, not from what the client wrote at the start", async () => {
    const app = await limited({ AUTH_RATE_LIMIT_PER_MINUTE: "2" });
    const proxy = address();

    // The same real client (the last entry, written by the proxy), pretending to be a different one each time.
    const statuses: number[] = [];
    for (const forged of ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"]) {
      statuses.push((await signIn(app.url, `${forged}, ${proxy}`)).status);
    }

    expect(statuses).toEqual([401, 401, 429, 429]);
    await app.close();
  });

  it("enforces one limit across two instances sharing the database, where in-memory counters would allow it twice", async () => {
    const first = await limited({ AUTH_RATE_LIMIT_PER_MINUTE: "4" });
    const second = await limited({ AUTH_RATE_LIMIT_PER_MINUTE: "4" });
    const mine = client();

    const statuses = [
      (await signIn(first.url, mine)).status,
      (await signIn(second.url, mine)).status,
      (await signIn(first.url, mine)).status,
      (await signIn(second.url, mine)).status,
      (await signIn(first.url, mine)).status,
      (await signIn(second.url, mine)).status,
    ];

    expect(statuses.filter((status) => status === 401)).toHaveLength(4);
    expect(statuses.filter((status) => status === 429)).toHaveLength(2);
    await first.close();
    await second.close();
  });

  it("has a looser limit for the rest of the API, and counts the strict routes separately", async () => {
    const app = await limited({ RATE_LIMIT_PER_MINUTE: "3", AUTH_RATE_LIMIT_PER_MINUTE: "50" });
    const mine = client();
    const get = () => fetch(`${app.url}/nowhere`, { headers: { "x-forwarded-for": mine } });

    const statuses = [(await get()).status, (await get()).status, (await get()).status, (await get()).status];

    expect(statuses).toEqual([404, 404, 404, 429]);
    await app.close();
  });

  it("describes the budget on every response", async () => {
    const app = await limited({ RATE_LIMIT_PER_MINUTE: "10" });

    const reply = await fetch(`${app.url}/nowhere`, { headers: { "x-forwarded-for": client() } });

    expect(reply.headers.get("ratelimit-limit")).toBe("10");
    expect(reply.headers.get("ratelimit-remaining")).toBe("9");
    await app.close();
  });
});

