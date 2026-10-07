import { request as httpRequest, createServer, type IncomingMessage, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { sendWebResponse } from "./node-adapter.js";

// `sendWebResponse` over a real socket: what it must do for a streamed body, not just a small one. A real server and a
// raw client, so backpressure and disconnects are the operating system's, not simulated.

const servers: Server[] = [];

/** The port a listening server got, checked rather than asserted. */
function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the server is not listening on a TCP port");
  }
  return address.port;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })));
});

interface Served {
  port: number;
  /** What `sendWebResponse` settled with for the last request: `undefined` for resolved, or the error it rejected with. */
  outcomes: Array<{ ok: true } | { ok: false; error: unknown }>;
}

async function serve(make: () => Response): Promise<Served> {
  const outcomes: Served["outcomes"] = [];
  const server = createServer((_request, res) => {
    sendWebResponse(make(), res).then(
      () => outcomes.push({ ok: true }),
      (error: unknown) => outcomes.push({ ok: false, error }),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: portOf(server), outcomes };
}

/** Streams the given chunks, one per pull, recording how many were pulled and whether the source was cancelled. */
function source(chunks: Uint8Array[], options: { delayMs?: number; failAfter?: number } = {}) {
  const state = { pulled: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      if (options.failAfter !== undefined && state.pulled >= options.failAfter) {
        controller.error(new Error("the producer failed"));
        return;
      }
      const chunk = chunks[state.pulled];
      state.pulled += 1;
      if (chunk === undefined) {
        controller.close();
      } else {
        controller.enqueue(chunk);
      }
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { state, body };
}

const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);
const until = async (condition: () => boolean, ms = 3000) => {
  for (let waited = 0; waited < ms && !condition(); waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return condition();
};

/** A client that hands the response to `onResponse` and resolves with every byte it received (or the error that ended it). */
function get(port: number, onResponse?: (response: IncomingMessage) => void, method = "GET"): Promise<{ body: Buffer; error?: Error }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const request = httpRequest({ port, host: "127.0.0.1", method }, (response) => {
      onResponse?.(response);
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ body: Buffer.concat(chunks) }));
      response.on("error", (error) => resolve({ body: Buffer.concat(chunks), error }));
      response.on("aborted", () => resolve({ body: Buffer.concat(chunks), error: new Error("aborted") }));
    });
    request.on("error", (error) => resolve({ body: Buffer.concat(chunks), error }));
    request.end();
  });
}

describe("sendWebResponse with a streamed body", () => {
  it("delivers every chunk intact and in order, empty ones included", async () => {
    const chunks = [bytes(1, 1), new Uint8Array(0), bytes(70_000, 2), bytes(3, 3), bytes(1_000_000, 4)];
    const { port } = await serve(() => new Response(source(chunks).body, { headers: { "content-type": "application/octet-stream" } }));

    const { body, error } = await get(port);

    expect(error).toBeUndefined();
    expect(body.equals(Buffer.concat(chunks))).toBe(true);
  });

  it("delivers a single large chunk intact", async () => {
    const chunk = bytes(8_000_000, 7);
    const { port } = await serve(() => new Response(chunk));

    const { body } = await get(port);

    expect(body.equals(Buffer.from(chunk))).toBe(true);
  });

  it("streams: the first chunk reaches the client before the producer has finished", async () => {
    const chunks = Array.from({ length: 6 }, (_, n) => bytes(10, n));
    const made = source(chunks, { delayMs: 60 });
    const { port } = await serve(() => new Response(made.body));
    let pulledAtFirstByte = -1;

    const { body } = await get(port, (response) => {
      response.once("data", () => {
        pulledAtFirstByte = made.state.pulled;
      });
      response.pause();
      response.resume();
    });

    expect(body.length).toBe(60);
    expect(pulledAtFirstByte).toBeGreaterThan(0);
    expect(pulledAtFirstByte).toBeLessThan(chunks.length);
  });

  it("applies backpressure: a client that stops reading stops the producer, and resuming loses nothing", async () => {
    const total = 600;
    const chunk = bytes(65_536, 9); // 39 MB in all
    const made = source(Array.from({ length: total }, () => chunk));
    const { port } = await serve(() => new Response(made.body));
    let held: IncomingMessage | undefined;

    const finished = get(port, (response) => {
      held = response;
      response.pause(); // read nothing
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const pulledWhileStalled = made.state.pulled;
    held?.resume();
    const { body } = await finished;

    expect(pulledWhileStalled).toBeGreaterThan(0);
    expect(pulledWhileStalled).toBeLessThan(total / 2); // not read ahead of a client that is not listening
    expect(body.length).toBe(total * chunk.length);
  });

  it("cancels the producer when the client disconnects mid-response, and does not treat that as an error", async () => {
    const made = source(Array.from({ length: 1000 }, () => bytes(65_536, 1)), { delayMs: 5 });
    const served = await serve(() => new Response(made.body));
    let socketDestroyed = false;

    await get(served.port, (response) => {
      response.once("data", () => {
        response.destroy();
        socketDestroyed = true;
      });
    });

    expect(socketDestroyed).toBe(true);
    expect(await until(() => made.state.cancelled)).toBe(true);
    expect(await until(() => served.outcomes.length === 1)).toBe(true);
    expect(served.outcomes[0]).toEqual({ ok: true });
    expect(made.state.pulled).toBeLessThan(1000);
  });

  it("cancels a producer that is stuck waiting (a read that never settles) when the client disconnects", async () => {
    // Nothing is flowing, so the loop has no next chunk to notice the disconnect with: only the close event can unblock it.
    const state = { cancelled: false };
    let sent = false;
    const stuck = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(bytes(100, 1));
          return undefined;
        }
        return new Promise<void>(() => {}); // waits for something that never comes
      },
      cancel() {
        state.cancelled = true;
      },
    });
    const served = await serve(() => new Response(stuck));

    await get(served.port, (response) => {
      response.once("data", () => response.destroy());
    });

    expect(await until(() => state.cancelled)).toBe(true);
    expect(await until(() => served.outcomes.length === 1)).toBe(true);
    expect(served.outcomes[0]).toEqual({ ok: true });
  });

  it("cancels the producer when the response is destroyed by the server's own code mid-stream", async () => {
    const state = { cancelled: false, pulled: 0 };
    let destroy: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        state.pulled += 1;
        if (state.pulled === 2) {
          destroy?.();
        }
        controller.enqueue(bytes(100, state.pulled));
      },
      cancel() {
        state.cancelled = true;
      },
    });
    const outcomes: Served["outcomes"] = [];
    const server = createServer((_request, res) => {
      destroy = () => res.destroy();
      sendWebResponse(new Response(body), res).then(
        () => outcomes.push({ ok: true }),
        (error: unknown) => outcomes.push({ ok: false, error }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    await get(portOf(server));

    expect(await until(() => state.cancelled)).toBe(true);
    expect(await until(() => outcomes.length === 1)).toBe(true);
    expect(outcomes[0]).toEqual({ ok: true });
  });

  it("rejects, and ends the connection without a clean finish, when the body fails mid-stream", async () => {
    const made = source([bytes(100, 1), bytes(100, 2), bytes(100, 3)], { failAfter: 2 });
    const served = await serve(() => new Response(made.body));

    const { body, error } = await get(served.port);

    expect(await until(() => served.outcomes.length === 1)).toBe(true);
    expect(served.outcomes[0]).toMatchObject({ ok: false, error: { message: "the producer failed" } });
    expect(error).toBeDefined(); // the client must not mistake a failed stream for a complete one
    expect(body.length).toBeLessThanOrEqual(200);
  });

  it("sends no body for a HEAD request, and settles", async () => {
    const served = await serve(() => new Response(source([bytes(1000, 1)]).body));

    const { body, error } = await get(served.port, undefined, "HEAD");

    expect(error).toBeUndefined();
    expect(body.length).toBe(0);
    expect(await until(() => served.outcomes.length === 1)).toBe(true);
    expect(served.outcomes[0]).toEqual({ ok: true });
  });

  it("handles many requests in a row on one connection", async () => {
    const { port } = await serve(() => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }));

    for (let i = 0; i < 200; i += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      expect(await response.text()).toBe('{"ok":true}');
    }
  });
});
