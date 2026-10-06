import { describe, expect, it } from "vitest";
import { SCENARIOS, startScenario, type Running, type Scenario } from "./scenarios.js";

/**
 * A benchmark that measures an error page, or a route that quietly does less than it says, produces a confident wrong
 * number. So each workload is checked to answer what its description claims, with the exact request the benchmark sends.
 */

async function send(running: Running, overrides: { headers?: Record<string, string | undefined> } = {}): Promise<Response> {
  const headers: Record<string, string> = { ...running.request.headers };
  for (const [name, value] of Object.entries(overrides.headers ?? {})) {
    if (value === undefined) {
      delete headers[name];
    } else {
      headers[name] = value;
    }
  }
  return fetch(`http://127.0.0.1:${running.port}${running.request.path}`, {
    method: running.request.method,
    headers,
    ...(running.request.body === undefined ? {} : { body: running.request.body }),
  });
}

async function withScenario<T>(scenario: Scenario, use: (running: Running) => Promise<T>): Promise<T> {
  const running = await startScenario(scenario);
  try {
    return await use(running);
  } finally {
    await running.close();
  }
}

describe("every workload answers what it claims, to the request the benchmark sends", () => {
  it.each(SCENARIOS)("%s answers 200 with JSON", async (scenario) => {
    await withScenario(scenario, async (running) => {
      const response = await send(running);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toBeTypeOf("object");
    });
  });

  it("validated validates the body and the response: the same object comes back, and a bad body is refused", async () => {
    await withScenario("validated", async (running) => {
      const ok = await send(running);
      const bad = await fetch(`http://127.0.0.1:${running.port}/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "", tags: [], count: 1.5 }) });

      expect(await ok.json()).toEqual({ name: "benchmark", tags: ["a", "b", "c"], count: 42 });
      expect(bad.status).toBe(400);
    });
  });

  it("authenticated really checks the token: without it, or with a bad one, the same route answers 401", async () => {
    await withScenario("authenticated", async (running) => {
      expect((await send(running, { headers: { authorization: undefined } })).status).toBe(401);
      expect((await send(running, { headers: { authorization: "Bearer not.a.token" } })).status).toBe(401);
      expect((await send(running)).status).toBe(200);
    });
  });

  it("middleware really runs the stack: CORS, security headers and the rate limit are on the response", async () => {
    await withScenario("middleware", async (running) => {
      const response = await send(running);

      expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("ratelimit-limit")).toBeTruthy();
    });
  });
});
