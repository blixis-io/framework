import { Module } from "@blixis/core";
import { Injectable } from "@blixis/di";
import { request as httpRequest } from "node:http";
import { describe, expect, it } from "vitest";
import { Controller } from "./decorators/controller.js";
import { Body, Param, Req } from "./decorators/params.js";
import { Get, Post } from "./decorators/routes.js";
import { createHttpApplication } from "./http-application.js";

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
