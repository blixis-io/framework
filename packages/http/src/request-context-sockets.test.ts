import { Module } from "@blixis-io/core";
import { Injectable } from "@blixis-io/di";
import { Agent, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { describe, expect, it } from "vitest";
import { Controller } from "./decorators/controller.js";
import type { CanActivate, ExecutionContext } from "./decorators/guards.js";
import { UseGuards } from "./decorators/guards.js";
import type { Interceptor } from "./decorators/interceptors.js";
import { UseInterceptors } from "./decorators/interceptors.js";
import { Body, Query } from "./decorators/params.js";
import { Get, Post } from "./decorators/routes.js";
import { createHttpApplication } from "./http-application.js";
import { RequestContext } from "./request-context.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Small deterministic generator, so the interleavings differ per request but a failure reproduces. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const jitter = (random: () => number) => sleep(Math.floor(random() * 15));

/** What `ctx.get("id")` returned at each stage of one request. */
type Trace = Record<string, unknown>;

/** Narrows parsed JSON to a plain object, failing the test loudly if the server sent something else. */
function asTrace(value: unknown): Trace {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`expected a JSON object, got ${JSON.stringify(value)}`);
  }
  return Object.fromEntries(Object.entries(value));
}

@Injectable()
class IdGuard implements CanActivate {
  constructor(private readonly ctx: RequestContext) {}

  async canActivate({ request }: ExecutionContext): Promise<boolean> {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    await sleep(Number(url.searchParams.get("guardMs") ?? 0));
    if (id !== null) {
      this.ctx.set("id", id);
    }
    return true;
  }
}

@Injectable()
class TraceInterceptor implements Interceptor {
  constructor(private readonly ctx: RequestContext) {}

  async intercept({ request }: ExecutionContext, next: () => Promise<Response>): Promise<Response> {
    const random = seeded(Number(new URL(request.url).searchParams.get("seed") ?? 1));
    await jitter(random);
    this.ctx.set("beforeNext", this.ctx.get("id"));
    const response = await next();
    await jitter(random);
    // After the handler: still our own context, then stamp it on the way out.
    const trace = asTrace(await response.json());
    return Response.json({ ...trace, afterNext: this.ctx.get("id"), beforeNext: this.ctx.get("beforeNext") });
  }
}

@Controller("ctx")
@UseGuards(IdGuard)
class ContextController {
  static late: string[] = [];

  constructor(private readonly ctx: RequestContext) {}

  /** Reads the context at several points, with a jittered wait between each. */
  @Post("trace")
  @UseInterceptors(TraceInterceptor)
  async trace(@Body() body: { seed: number }, @Query() query: Record<string, string>): Promise<Trace> {
    const random = seeded(body.seed);
    const trace: Trace = { id: query["id"], atStart: this.ctx.get("id") };
    await jitter(random);
    trace["afterFirstAwait"] = this.ctx.get("id");
    await Promise.all([jitter(random), jitter(random)]);
    trace["afterParallelAwaits"] = this.ctx.get("id");
    await new Promise<void>((resolve) => setImmediate(resolve));
    trace["afterSetImmediate"] = this.ctx.get("id");
    await new Promise<void>((resolve) => process.nextTick(resolve));
    trace["afterNextTick"] = this.ctx.get("id");
    return trace;
  }

  /** Reports what was already in the context on arrival, then leaves its own marker behind. */
  @Get("fresh")
  fresh(@Query() query: Record<string, string>) {
    const seenOnArrival = { id: this.ctx.get("id"), marker: this.ctx.get("marker") };
    this.ctx.set("marker", `left-by-${query["id"]}`);
    return { seenOnArrival };
  }

  /** Waits, then writes: the client may be gone or the request timed out by then. */
  @Get("slow-write")
  async slowWrite(@Query() query: Record<string, string>) {
    await sleep(Number(query["ms"] ?? 100));
    this.ctx.set("late", query["id"]);
    ContextController.late.push(String(this.ctx.get("id")));
    return { id: this.ctx.get("id") };
  }

  @Get("peek")
  peek() {
    return { id: this.ctx.get("id"), late: this.ctx.get("late"), has: this.ctx.has("late") };
  }
}

@Module({ providers: [IdGuard, TraceInterceptor], controllers: [ContextController] })
class ContextModule {}

async function postTrace(port: number, id: string, seed: number, guardMs: number): Promise<Trace> {
  const res = await fetch(`http://127.0.0.1:${port}/ctx/trace?id=${id}&seed=${seed}&guardMs=${guardMs}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seed }),
  });
  expect(res.status).toBe(200);
  return asTrace(await res.json());
}

describe("RequestContext under real sockets", () => {
  it("keeps 80 interleaved requests isolated through guard, body read, handler awaits, timers and interceptor", async () => {
    const app = await createHttpApplication(ContextModule);
    const { port } = await app.listen(0, "127.0.0.1");
    const random = seeded(42);

    try {
      const ids = Array.from({ length: 80 }, (_, index) => `req-${index}`);
      const traces = await Promise.all(ids.map((id, index) => postTrace(port, id, index + 1, Math.floor(random() * 25))));

      traces.forEach((trace, index) => {
        const id = ids[index];
        expect(trace).toEqual({
          id,
          atStart: id,
          afterFirstAwait: id,
          afterParallelAwaits: id,
          afterSetImmediate: id,
          afterNextTick: id,
          beforeNext: id,
          afterNext: id,
        });
      });
    } finally {
      await app.close();
    }
  });

  it("starts every request with an empty context, including on a reused keep-alive connection", async () => {
    const app = await createHttpApplication(ContextModule);
    const { port } = await app.listen(0, "127.0.0.1");
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });

    const get = (id: string) =>
      new Promise<{ body: Trace; socket: unknown }>((resolve, reject) => {
        const req = httpRequest({ host: "127.0.0.1", port, path: `/ctx/fresh?id=${id}`, agent }, (res) => {
          let text = "";
          res.on("data", (chunk: Buffer) => (text += chunk.toString()));
          res.on("end", () => resolve({ body: asTrace(JSON.parse(text)), socket: res.socket }));
        });
        req.on("error", reject);
        req.end();
      });

    try {
      const first = await get("one");
      const second = await get("two");
      const third = await get("three");

      expect(second.socket).toBe(first.socket); // the same connection really was reused
      expect(third.socket).toBe(first.socket);
      // The guard set `id` for the request itself; `marker` left by an earlier request on this connection must not be there.
      expect(first.body["seenOnArrival"]).toEqual({ id: "one" });
      expect(second.body["seenOnArrival"]).toEqual({ id: "two" });
      expect(third.body["seenOnArrival"]).toEqual({ id: "three" });
    } finally {
      agent.destroy();
      await app.close();
    }
  });

  it("lets an abandoned request finish into its own context without touching one that is still in flight", async () => {
    ContextController.late = [];
    const app = await createHttpApplication(ContextModule, { shutdownTimeout: 2000 });
    const { port } = await app.listen(0, "127.0.0.1");

    try {
      // `gone` connects, sends its request, and hangs up while the handler is still waiting.
      const gone = connect(port, "127.0.0.1");
      gone.on("error", () => {});
      gone.write("GET /ctx/slow-write?id=gone&ms=150 HTTP/1.1\r\nhost: x\r\n\r\n");
      await sleep(30);

      const staying = fetch(`http://127.0.0.1:${port}/ctx/slow-write?id=staying&ms=250`);
      await sleep(30);
      gone.destroy();

      const res = await staying;
      expect(await res.json()).toEqual({ id: "staying" });
      await sleep(50);
      // Both handlers ran to the end, each reading back its own id.
      expect([...ContextController.late].toSorted()).toEqual(["gone", "staying"]);

      const peek = await (await fetch(`http://127.0.0.1:${port}/ctx/peek?id=later`)).json();
      expect(peek).toEqual({ id: "later", has: false });
    } finally {
      await app.close();
    }
  });

  it("does not leak a write made after the request timed out into another request", async () => {
    ContextController.late = [];
    const app = await createHttpApplication(ContextModule, { requestTimeout: 60, shutdownTimeout: 2000 });
    const { port } = await app.listen(0, "127.0.0.1");

    try {
      const timedOut = await fetch(`http://127.0.0.1:${port}/ctx/slow-write?id=timedout&ms=150`);
      expect(timedOut.status).toBe(504);

      // The handler is still running in the background and writes `late` at ~150 ms; these overlap that moment.
      await sleep(70);
      const overlapping = await Promise.all(
        Array.from({ length: 5 }, async (_, index) => {
          await sleep(index * 10);
          return (await fetch(`http://127.0.0.1:${port}/ctx/peek?id=p${index}`)).json();
        }),
      );
      await sleep(100);

      expect(ContextController.late).toEqual(["timedout"]); // it did finish, and saw its own id
      overlapping.forEach((peek, index) => {
        expect(peek).toEqual({ id: `p${index}`, has: false });
      });
    } finally {
      await app.close();
    }
  });
});
