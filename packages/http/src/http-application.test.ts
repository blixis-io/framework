import { Module } from "@blixis-io/core";
import { Injectable } from "@blixis-io/di";
import { request as httpRequest } from "node:http";
import { describe, expect, it } from "vitest";
import { Controller } from "./decorators/controller.js";
import type { CanActivate, ExecutionContext } from "./decorators/guards.js";
import { UseGuards } from "./decorators/guards.js";
import { Body, Param, Req } from "./decorators/params.js";
import { Get, Post } from "./decorators/routes.js";
import { createHttpApplication } from "./http-application.js";
import { RequestContext } from "./request-context.js";

@Injectable()
class GreetingService {
  greet(name: string): string {
    return `hello, ${name}`;
  }
}

@Controller("greet")
class GreetingController {
  constructor(private readonly service: GreetingService) {}

  @Get(":name")
  greet(@Param("name") name: string) {
    return { message: this.service.greet(name) };
  }

  @Post()
  echo(@Body() body: unknown) {
    return body;
  }
}

@Module({ providers: [GreetingService], controllers: [GreetingController] })
class GreetingModule {}

describe("createHttpApplication: get()", () => {
  it("fetches an already-resolved provider directly, bypassing HTTP", async () => {
    const app = await createHttpApplication(GreetingModule);

    expect(app.get(GreetingService)).toBeInstanceOf(GreetingService);

    await app.close();
  });
});

describe("createHttpApplication: controllers", () => {
  it("exposes every controller class in the app's module graph", async () => {
    const app = await createHttpApplication(GreetingModule);

    expect(app.controllers).toEqual([GreetingController]);

    await app.close();
  });
});

describe("createHttpApplication: in-process handle()", () => {
  it("wraps createApplication and serves requests without a socket", async () => {
    const app = await createHttpApplication(GreetingModule);

    const res = await app.handle(new Request("http://localhost/greet/world"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "hello, world" });

    await app.close();
  });
});

describe("createHttpApplication: real socket", () => {
  it("serves real HTTP requests over a listening socket via fetch()", async () => {
    const app = await createHttpApplication(GreetingModule);
    const { port } = await app.listen(0, "127.0.0.1");

    try {
      const res = await fetch(`http://127.0.0.1:${port}/greet/socket-world`);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ message: "hello, socket-world" });
    } finally {
      await app.close();
    }
  });

  it("round-trips a real JSON POST body over the socket", async () => {
    const app = await createHttpApplication(GreetingModule);
    const { port } = await app.listen(0, "127.0.0.1");

    try {
      const res = await fetch(`http://127.0.0.1:${port}/greet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ echoed: true }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ echoed: true });
    } finally {
      await app.close();
    }
  });

  it("returns a real 404 problem+json response over the socket for an unknown path", async () => {
    const app = await createHttpApplication(GreetingModule);
    const { port } = await app.listen(0, "127.0.0.1");

    try {
      const res = await fetch(`http://127.0.0.1:${port}/nope`);

      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toBe("application/problem+json");
    } finally {
      await app.close();
    }
  });

  it("streams a real 204 (empty body) response correctly over the socket", async () => {
    const app = await createHttpApplication(GreetingModule);
    const { port } = await app.listen(0, "127.0.0.1");

    try {
      const res = await fetch(`http://127.0.0.1:${port}/greet`, { method: "POST" });

      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
    } finally {
      await app.close();
    }
  });

  it("propagates a real client abort to the Request's AbortSignal", async () => {
    let resolveAborted!: () => void;
    const abortedPromise = new Promise<void>((resolve) => {
      resolveAborted = resolve;
    });
    let resolveReceived!: () => void;
    const receivedPromise = new Promise<void>((resolve) => {
      resolveReceived = resolve;
    });

    @Controller("slow")
    class SlowController {
      @Get()
      async slow(@Req() req: Request) {
        req.signal.addEventListener("abort", () => resolveAborted());
        resolveReceived();
        // Circuit breaker so a broken abort mechanism can't hang the server forever.
        await Promise.race([abortedPromise, new Promise((resolve) => setTimeout(resolve, 2000))]);
        return { ok: true };
      }
    }

    @Module({ controllers: [SlowController] })
    class SlowModule {}

    const app = await createHttpApplication(SlowModule);
    const { port } = await app.listen(0, "127.0.0.1");

    try {
      const clientReq = httpRequest({ host: "127.0.0.1", port, path: "/slow", method: "GET" });
      // We destroy this request ourselves below to simulate a client abort;
      // that self-inflicted socket error is expected, not a real failure.
      clientReq.on("error", () => {});
      clientReq.end();
      await receivedPromise;
      clientReq.destroy();

      await expect(abortedPromise).resolves.toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("close() is idempotent: a second call does not error (ERR_SERVER_NOT_RUNNING)", async () => {
    const app = await createHttpApplication(GreetingModule);
    await app.listen(0, "127.0.0.1");

    await app.close();
    await expect(app.close()).resolves.toBeUndefined();
  });

  it("rejects listen() when the port is already in use", async () => {
    const first = await createHttpApplication(GreetingModule);
    const { port } = await first.listen(0, "127.0.0.1");

    const second = await createHttpApplication(GreetingModule);

    try {
      await expect(second.listen(port, "127.0.0.1")).rejects.toThrow("EADDRINUSE");
    } finally {
      await first.close();
      await second.close();
    }
  });
});

describe("createHttpApplication: RequestContext", () => {
  it("injects RequestContext into a controller without it being declared in any module's providers", async () => {
    @Controller("whoami")
    class WhoAmIController {
      constructor(private readonly ctx: RequestContext) {}

      @Get()
      whoami() {
        return { user: this.ctx.get("user") ?? null };
      }
    }

    @Module({ controllers: [WhoAmIController] })
    class WhoAmIModule {}

    const app = await createHttpApplication(WhoAmIModule);

    const res = await app.handle(new Request("http://localhost/whoami"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: null });

    await app.close();
  });

  it("carries a value a guard sets through to the controller handling the same request", async () => {
    @Injectable()
    class AuthGuard implements CanActivate {
      constructor(private readonly ctx: RequestContext) {}

      canActivate(_context: ExecutionContext): boolean {
        this.ctx.set("user", { id: 7, name: "ada" });
        return true;
      }
    }

    @Controller("me")
    @UseGuards(AuthGuard)
    class MeController {
      constructor(private readonly ctx: RequestContext) {}

      @Get()
      me() {
        return this.ctx.get("user");
      }
    }

    @Module({ providers: [AuthGuard], controllers: [MeController] })
    class MeModule {}

    const app = await createHttpApplication(MeModule);

    const res = await app.handle(new Request("http://localhost/me"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 7, name: "ada" });

    await app.close();
  });

  it("keeps concurrent real HTTP requests fully isolated from each other's context", async () => {
    @Injectable()
    class TagGuard implements CanActivate {
      constructor(private readonly ctx: RequestContext) {}

      async canActivate({ request }: ExecutionContext): Promise<boolean> {
        const tag = new URL(request.url).searchParams.get("tag");
        // Yield before writing so two concurrent requests genuinely
        // interleave instead of finishing one before the other starts.
        await new Promise((resolve) => setTimeout(resolve, tag === "slow" ? 20 : 0));
        this.ctx.set("tag", tag);
        return true;
      }
    }

    @Controller("tag")
    @UseGuards(TagGuard)
    class TagController {
      constructor(private readonly ctx: RequestContext) {}

      @Get()
      async tag() {
        // Also yield here so a leak from the other request-in-flight would
        // have a chance to clobber this one before the response is built.
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { tag: this.ctx.get("tag") };
      }
    }

    @Module({ providers: [TagGuard], controllers: [TagController] })
    class TagModule {}

    const app = await createHttpApplication(TagModule);
    const { port } = await app.listen(0, "127.0.0.1");

    try {
      const [slow, fast] = await Promise.all([
        fetch(`http://127.0.0.1:${port}/tag?tag=slow`),
        fetch(`http://127.0.0.1:${port}/tag?tag=fast`),
      ]);

      expect(await slow.json()).toEqual({ tag: "slow" });
      expect(await fast.json()).toEqual({ tag: "fast" });
    } finally {
      await app.close();
    }
  });
});

describe("HttpApplication.close(): graceful shutdown", () => {
  @Controller("work")
  class WorkController {
    static aborted = false;

    @Get("quick")
    async quick() {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { done: true };
    }

    @Get("hang")
    async hang(@Req() request: Request) {
      await new Promise<void>((resolve) => {
        request.signal.addEventListener("abort", () => {
          WorkController.aborted = true;
          resolve();
        });
      });
      return { done: false };
    }
  }

  @Module({ controllers: [WorkController] })
  class WorkModule {}

  it("lets an in-flight request finish before close() resolves", async () => {
    const app = await createHttpApplication(WorkModule);
    const { port } = await app.listen(0, "127.0.0.1");

    const pending = fetch(`http://127.0.0.1:${port}/work/quick`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await app.close();

    const res = await pending;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: true });
  });

  it("cuts off a request still running at shutdownTimeout and aborts its signal", async () => {
    WorkController.aborted = false;
    const app = await createHttpApplication(WorkModule, { shutdownTimeout: 50 });
    const { port } = await app.listen(0, "127.0.0.1");

    const pending = fetch(`http://127.0.0.1:${port}/work/hang`).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await app.close();

    expect(await pending).toBeInstanceOf(Error);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(WorkController.aborted).toBe(true);
  });

  it("does not hang close() on an idle keep-alive connection", async () => {
    const app = await createHttpApplication(WorkModule, { shutdownTimeout: 60_000 });
    const { port } = await app.listen(0, "127.0.0.1");

    await (await fetch(`http://127.0.0.1:${port}/work/quick`)).json();

    await expect(app.close()).resolves.toBeUndefined();
  });
});

describe("HttpApplication.mount()", () => {
  it("serves a mounted exact path ahead of the router and leaves other routes alone", async () => {
    const app = await createHttpApplication(GreetingModule);
    app.mount("GET", "/status", () => new Response("up"));

    const mounted = await app.handle(new Request("http://localhost/status"));
    const routed = await app.handle(new Request("http://localhost/greet/blixis"));

    expect(await mounted.text()).toBe("up");
    expect(await routed.json()).toEqual({ message: "hello, blixis" });
    await app.close();
  });

  it("only matches the mounted method", async () => {
    const app = await createHttpApplication(GreetingModule);
    app.mount("GET", "/status", () => new Response("up"));

    const res = await app.handle(new Request("http://localhost/status", { method: "POST" }));

    expect(res.status).toBe(404);
    await app.close();
  });

  it("throws when the same method and path are mounted twice", async () => {
    const app = await createHttpApplication(GreetingModule);
    app.mount("GET", "/status", () => new Response("up"));

    expect(() => {
      app.mount("GET", "/status", () => new Response("again"));
    }).toThrow("GET /status is already mounted");
    await app.close();
  });
});
