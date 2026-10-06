import { Module } from "@blixis-io/core";
import { Injectable } from "@blixis-io/di";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Controller } from "./decorators/controller.js";
import { UseGuards, type CanActivate } from "./decorators/guards.js";
import { Body, Req } from "./decorators/params.js";
import { Get, Post } from "./decorators/routes.js";
import { createFetchHandler } from "./fetch-handler.js";
import { UnauthorizedException } from "./exceptions.js";
import { createHttpApplication, type Middleware } from "./http-application.js";
import { withResponseHeaders } from "./request-id.js";
import { RequestContext } from "./request-context.js";

@Injectable()
class DenyGuard implements CanActivate {
  canActivate(): boolean {
    return false;
  }
}

@Controller("things")
class ThingsController {
  constructor(private readonly context: RequestContext) {}

  @Get()
  list() {
    return { ok: true };
  }

  @Get("boom")
  boom(): never {
    throw new Error("unexpected");
  }

  @Get("secret")
  @UseGuards(DenyGuard)
  secret() {
    return {};
  }

  @Post()
  create(@Body(z.object({ title: z.string() })) body: { title: string }) {
    return body;
  }

  @Get("context")
  readContext() {
    return { fromMiddleware: this.context.get("from-middleware") ?? null };
  }

  @Get("echo-header")
  echoHeader(@Req() request: Request) {
    return { value: request.headers.get("x-added") };
  }

  @Get("slow")
  async slow() {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return {};
  }
}

@Module({ providers: [DenyGuard], controllers: [ThingsController] })
class AppModule {}

const get = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

/** Records `METHOD path -> status` for every request and answers with the application's response untouched. */
function recorder(seen: string[]): Middleware {
  return async (request, next) => {
    const response = await next();
    seen.push(`${request.method} ${new URL(request.url).pathname} -> ${response.status}`);
    return response;
  };
}

const stampThrough: Middleware = async (_request, next) => {
  const response = await next();
  response.headers.set("x-through", "middleware");
  return response;
};

const callsNextTwice: Middleware = async (_request, next) => {
  await next();
  return next();
};

// @ts-expect-error -- deliberately not a Response
const returnsNoResponse: Middleware = () => "nope";

const denyFraming: Middleware = async (_request, next) => {
  const response = await next();
  response.headers.set("x-frame-options", "DENY");
  return response;
};

const addRequestHeader: Middleware = (request, next) => {
  const headers = new Headers(request.headers);
  headers.set("x-added", "yes");
  return next(new Request(request, { headers }));
};

describe("middleware: sees every request path", () => {
  it("sees routed responses, the router's refusals, guard denials, validation errors, controller errors, mounted routes and timeouts", async () => {
    const seen: string[] = [];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await createHttpApplication(AppModule, { middleware: [recorder(seen)], requestTimeout: 50 });
    app.mount("GET", "/status", () => new Response("up"));

    await app.handle(get("/things"));
    await app.handle(get("/nowhere"));
    await app.handle(get("/things", { method: "DELETE" }));
    await app.handle(get("/things/100%"));
    await app.handle(get("/things/secret"));
    await app.handle(get("/things", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }));
    await app.handle(get("/things/boom"));
    await app.handle(get("/status"));
    await app.handle(get("/things/slow"));

    expect(seen).toEqual([
      "GET /things -> 200",
      "GET /nowhere -> 404",
      "DELETE /things -> 405",
      "GET /things/100% -> 400",
      "GET /things/secret -> 403",
      "POST /things -> 400",
      "GET /things/boom -> 500",
      "GET /status -> 200",
      "GET /things/slow -> 504",
    ]);
    error.mockRestore();
    await app.close();
  });

  it("sees a failure inside a mounted handler as a 500 response, not a rejection", async () => {
    const seen: string[] = [];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await createHttpApplication(AppModule, { middleware: [recorder(seen)] });
    app.mount("GET", "/broken", () => {
      throw new Error("mounted failed");
    });

    const response = await app.handle(get("/broken"));

    expect(response.status).toBe(500);
    expect(seen).toEqual(["GET /broken -> 500"]);
    error.mockRestore();
    await app.close();
  });
});

describe("middleware: order and control", () => {
  it("runs outermost first and unwinds in reverse", async () => {
    const order: string[] = [];
    const mark =
      (name: string): Middleware =>
      async (_request, next) => {
        order.push(`${name} in`);
        const response = await next();
        order.push(`${name} out`);
        return response;
      };
    const app = await createHttpApplication(AppModule, { middleware: [mark("a"), mark("b")] });

    await app.handle(get("/things"));

    expect(order).toEqual(["a in", "b in", "b out", "a out"]);
    await app.close();
  });

  it("lets a middleware change every response, including the ones the router produces", async () => {
    const app = await createHttpApplication(AppModule, { middleware: [denyFraming] });

    for (const path of ["/things", "/nowhere"]) {
      expect((await app.handle(get(path))).headers.get("x-frame-options")).toBe("DENY");
    }
    await app.close();
  });

  it("answers with its own response without calling next(), so nothing downstream runs", async () => {
    const reached: string[] = [];
    const app = await createHttpApplication(AppModule, {
      middleware: [
        () => new Response("slow down", { status: 429 }),
        async (_request, next) => {
          reached.push("second");
          return next();
        },
      ],
    });

    const response = await app.handle(get("/things"));

    expect(response.status).toBe(429);
    expect(reached).toEqual([]);
    await app.close();
  });

  it("hands a changed request to the rest of the chain", async () => {
    const app = await createHttpApplication(AppModule, { middleware: [addRequestHeader] });

    const response = await app.handle(get("/things/echo-header"));

    expect(await response.json()).toEqual({ value: "yes" });
    await app.close();
  });
});

describe("middleware: errors", () => {
  it("answers an HttpException thrown by a middleware with that exception's problem+json", async () => {
    const app = await createHttpApplication(AppModule, {
      middleware: [
        () => {
          throw new UnauthorizedException("no token");
        },
      ],
    });

    const response = await app.handle(get("/things"));

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(z.object({ detail: z.string() }).parse(await response.json()).detail).toBe("no token");
    await app.close();
  });

  it("logs any other error from a middleware and answers a generic 500", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await createHttpApplication(AppModule, {
      middleware: [
        () => {
          throw new Error("secret internals");
        },
      ],
    });

    const response = await app.handle(get("/things"));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret internals");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    await app.close();
  });

  it("answers 500 when next() is called twice", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await createHttpApplication(AppModule, { middleware: [callsNextTwice] });

    expect((await app.handle(get("/things"))).status).toBe(500);
    error.mockRestore();
    await app.close();
  });

  it("answers 500 when a middleware returns something that is not a Response", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await createHttpApplication(AppModule, { middleware: [returnsNoResponse] });

    expect((await app.handle(get("/things"))).status).toBe(500);
    error.mockRestore();
    await app.close();
  });
});

const throwsUnauthorized: Middleware = () => {
  throw new UnauthorizedException("no token");
};

const throwsError: Middleware = () => {
  throw new Error("inner failure");
};

describe("middleware: an error thrown further in reaches the middleware outside as a response", () => {
  it("shows an outer middleware the problem response of an HttpException thrown by an inner one, and lets it decorate it", async () => {
    const seen: number[] = [];
    const decorate: Middleware = async (_request, next) => {
      const response = await next();
      seen.push(response.status);
      return withResponseHeaders(response, { "x-outer": "saw it" });
    };
    const app = await createHttpApplication(AppModule, { middleware: [decorate, throwsUnauthorized] });

    const response = await app.handle(get("/things"));

    expect(seen).toEqual([401]);
    expect(response.status).toBe(401);
    expect(response.headers.get("x-outer")).toBe("saw it");
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    await app.close();
  });

  it("shows it a generic 500 for any other error, which is still logged once", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: number[] = [];
    const observe: Middleware = async (_request, next) => {
      const response = await next();
      seen.push(response.status);
      return response;
    };
    const app = await createHttpApplication(AppModule, { middleware: [observe, throwsError] });

    expect((await app.handle(get("/things"))).status).toBe(500);

    expect(seen).toEqual([500]);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
    await app.close();
  });

  it("does not let next() reject, so a middleware never needs a try/catch around it", async () => {
    let rejected = false;
    const guarded: Middleware = async (_request, next) => {
      try {
        return await next();
      } catch {
        rejected = true;
        return new Response("never");
      }
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await createHttpApplication(AppModule, { middleware: [guarded, throwsError] });

    await app.handle(get("/things"));

    expect(rejected).toBe(false);
    error.mockRestore();
    await app.close();
  });
});

describe("middleware: request context", () => {
  it("shares one request scope with the controller, and keeps concurrent requests apart", async () => {
    const app = await createHttpApplication(AppModule, {
      middleware: [
        async (request, next) => {
          app.get(RequestContext).set("from-middleware", new URL(request.url).searchParams.get("id"));
          await new Promise((resolve) => setTimeout(resolve, 10));
          return next();
        },
      ],
    });

    const bodies = await Promise.all(
      ["a", "b", "c"].map(async (id) => (await app.handle(get(`/things/context?id=${id}`))).json()),
    );

    expect(bodies).toEqual([{ fromMiddleware: "a" }, { fromMiddleware: "b" }, { fromMiddleware: "c" }]);
    await app.close();
  });

  it("gives a request made from inside a handler its own scope", async () => {
    const inner: unknown[] = [];
    const app = await createHttpApplication(AppModule, {
      middleware: [
        async (request, next) => {
          if (new URL(request.url).pathname === "/things/context") {
            inner.push(app.get(RequestContext).get("from-middleware"));
          } else {
            app.get(RequestContext).set("from-middleware", "outer");
            await app.handle(get("/things/context"));
          }
          return next();
        },
      ],
    });

    await app.handle(get("/things"));

    expect(inner).toEqual([undefined]);
    await app.close();
  });
});

describe("middleware: other entry points", () => {
  it("applies through createFetchHandler", async () => {
    const seen: string[] = [];
    const handler = createFetchHandler(AppModule, { middleware: [recorder(seen)] });

    await handler.fetch(get("/things"));
    await handler.fetch(get("/nowhere"));

    expect(seen).toEqual(["GET /things -> 200", "GET /nowhere -> 404"]);
    await handler.close();
  });

  it("applies over a real socket, including to a 404", async () => {
    const app = await createHttpApplication(AppModule, { middleware: [stampThrough] });
    const { port } = await app.listen(0, "127.0.0.1");

    const ok = await fetch(`http://127.0.0.1:${port}/things`);
    const missing = await fetch(`http://127.0.0.1:${port}/nowhere`);

    expect([ok.status, ok.headers.get("x-through")]).toEqual([200, "middleware"]);
    expect([missing.status, missing.headers.get("x-through")]).toEqual([404, "middleware"]);
    await app.close();
  });

  it("changes nothing when no middleware is given", async () => {
    const app = await createHttpApplication(AppModule);

    expect((await app.handle(get("/things"))).status).toBe(200);
    expect((await app.handle(get("/nowhere"))).status).toBe(404);
    await app.close();
  });
});
