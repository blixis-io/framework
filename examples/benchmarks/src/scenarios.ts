import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { defineAuthModule } from "@blixis-io/auth";
import { Module } from "@blixis-io/core";
import { Body, Controller, createHttpApplication, Get, Post, Returns, type HttpApplication, type Middleware } from "@blixis-io/http";
import { cors, MemoryRateLimitStore, rateLimit, securityHeaders } from "@blixis-io/security";
import { z } from "zod";

/**
 * The workloads. Each is a real server on a real socket answering one route; the benchmark drives it with many
 * concurrent connections. They are ordered from "almost nothing" to "everything a typical request does", so the
 * difference between two neighbours is what one piece costs.
 */

export const SECRET = "benchmark-secret-benchmark-secret-benchmark-secret";

const EchoSchema = z.object({ name: z.string().min(1), tags: z.array(z.string()), count: z.number().int() });

@Controller()
class PingController {
  @Get("ping")
  ping() {
    return { ok: true };
  }

  @Post("echo")
  @Returns(EchoSchema)
  echo(@Body(EchoSchema) body: z.infer<typeof EchoSchema>) {
    return body;
  }
}

const auth = defineAuthModule(z.object({ sub: z.string(), email: z.string() }));

@Controller()
class MeController {
  @Get("me")
  me() {
    return { ok: true };
  }
}

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");

/** A signed token, made by hand so the benchmark needs no JWT library: HS256, one hour. */
export function makeToken(): string {
  const head = encode({ alg: "HS256" });
  const body = encode({ sub: "user-1", email: "bench@example.com", exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${head}.${body}.${createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`;
}

export interface Running {
  port: number;
  /** What to send for one request of this scenario. */
  request: { method: "GET" | "POST"; path: string; headers?: Record<string, string>; body?: string;
    /** The path holds `[<id>]`, which the runner replaces with a different whole number for every request. */
    varyId?: boolean;
  };
  close(): Promise<void>;
}

export const SCENARIOS = ["node-http", "ping", "validated", "authenticated", "middleware"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const DESCRIPTIONS: Record<Scenario, string> = {
  "node-http": "bare `node:http`, one JSON response (the floor Node itself sets)",
  ping: "a controller route returning a small object (routing, request/response conversion, response validation off)",
  validated: "POST a JSON body validated with Zod and returned through a `@Returns` schema (body read, parse, both validations)",
  authenticated: "a route behind `protectAllRoutes` with a valid HS256 bearer token (JWT verification and claims validation on every request)",
  middleware: "a route behind CORS, security headers and a rate limiter (in-memory store), with an Origin header (the baseline production stack)",
};

function listening(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : 0);
    });
  });
}

async function http(module: new () => object, middleware: Middleware[] = []): Promise<{ app: HttpApplication; port: number }> {
  const app = await createHttpApplication(module, { middleware });
  const { port } = await app.listen(0, "127.0.0.1");
  return { app, port };
}

export async function startScenario(scenario: Scenario): Promise<Running> {
  if (scenario === "node-http") {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
    });
    const port = await listening(server);
    return { port, request: { method: "GET", path: "/ping" }, close: () => new Promise((resolve) => server.close(() => resolve())) };
  }

  if (scenario === "ping") {
    @Module({ controllers: [PingController] })
    class PingModule {}
    const { app, port } = await http(PingModule);
    return { port, request: { method: "GET", path: "/ping" }, close: () => app.close() };
  }

  if (scenario === "validated") {
    @Module({ controllers: [PingController] })
    class EchoModule {}
    const { app, port } = await http(EchoModule);
    return {
      port,
      request: { method: "POST", path: "/echo", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "benchmark", tags: ["a", "b", "c"], count: 42 }) },
      close: () => app.close(),
    };
  }

  if (scenario === "authenticated") {
    @Module({ imports: [auth.AuthModule.forRoot({ secret: SECRET, protectAllRoutes: true })], controllers: [MeController] })
    class AuthedModule {}
    const { app, port } = await http(AuthedModule);
    return { port, request: { method: "GET", path: "/me", headers: { authorization: `Bearer ${makeToken()}` } }, close: () => app.close() };
  }

  @Module({ controllers: [PingController] })
  class StackModule {}
  const { app, port } = await http(StackModule, [
    cors({ origins: ["https://app.example.com"] }),
    securityHeaders(),
    // A limit nobody reaches: the cost being measured is counting, not refusing.
    rateLimit({ store: new MemoryRateLimitStore(), limit: 1_000_000_000, windowMs: 60_000, key: () => "bench" }),
  ]);
  return { port, request: { method: "GET", path: "/ping", headers: { origin: "https://app.example.com" } }, close: () => app.close() };
}
