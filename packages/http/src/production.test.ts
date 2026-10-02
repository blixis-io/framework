import { Module } from "@blixis-io/core";
import { connect } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Controller } from "./decorators/controller.js";
import { Get, Post } from "./decorators/routes.js";
import { Body } from "./decorators/params.js";
import { createHttpApplication } from "./http-application.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const state = { pulled: 0, cancelled: false };

@Controller("stream")
class StreamController {
  /** Endless stream of 64 KiB chunks. */
  @Get("endless")
  endless() {
    const chunk = new Uint8Array(64 * 1024).fill(120);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        state.pulled += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        state.cancelled = true;
      },
    });
    return new Response(body, { headers: { "content-type": "application/octet-stream" } });
  }

  /** Sends one chunk, then errors the stream after the headers are already out. */
  @Get("explode")
  explode() {
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(new TextEncoder().encode("partial"));
          return;
        }
        controller.error(new Error("source failed mid-stream"));
      },
    });
    return new Response(body);
  }

  @Post("echo")
  echo(@Body() body: unknown) {
    return body;
  }
}

@Module({ controllers: [StreamController] })
class StreamModule {}

const uploads: unknown[] = [];

@Controller("upload")
class UploadController {
  @Post()
  upload(@Body() body: unknown) {
    uploads.push(body);
    return { received: body };
  }
}

@Module({ controllers: [UploadController] })
class UploadModule {}

const JSON_POST = "POST /upload HTTP/1.1\r\nhost: x\r\ncontent-type: application/json\r\n";

/** Writes raw bytes to a fresh connection and resolves with everything the server sent back before closing it (or before `waitMs`, then hangs up). */
function rawExchange(port: number, payload: string, waitMs = 1000): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    let received = "";
    socket.on("data", (chunk) => {
      received += chunk.toString();
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      clearTimeout(hangUp);
      resolve(received);
    });
    const hangUp = setTimeout(() => socket.destroy(), waitMs);
    socket.write(payload);
  });
}

/** A normal request on a new connection must still succeed: the malformed one before it didn't take the server down. */
async function expectStillServing(port: number): Promise<void> {
  const ok = await fetch(`http://127.0.0.1:${port}/upload`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ still: "up" }),
  });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ received: { still: "up" } });
}

describe("production behaviour over a real socket", () => {
  it("applies backpressure: a client that stops reading does not make the server buffer the whole stream", async () => {
    state.pulled = 0;
    state.cancelled = false;
    const app = await createHttpApplication(StreamModule, { shutdownTimeout: 200 });
    const { port } = await app.listen(0, "127.0.0.1");

    const socket = connect(port, "127.0.0.1");
    socket.pause();
    socket.write("GET /stream/endless HTTP/1.1\r\nhost: x\r\n\r\n");
    await sleep(300);
    const pulledWhilePaused = state.pulled;
    await sleep(300);

    expect(state.pulled).toBe(pulledWhilePaused); // stable: producer is throttled, not racing ahead
    expect(pulledWhilePaused * 64).toBeLessThan(16 * 1024); // well under 16 MiB buffered

    socket.destroy();
    await app.close();
  });

  it("cancels the response stream when the client disconnects mid-response", async () => {
    state.pulled = 0;
    state.cancelled = false;
    const app = await createHttpApplication(StreamModule, { shutdownTimeout: 5000 });
    const { port } = await app.listen(0, "127.0.0.1");

    const socket = connect(port, "127.0.0.1");
    socket.write("GET /stream/endless HTTP/1.1\r\nhost: x\r\n\r\n");
    await new Promise((resolve) => socket.once("data", resolve));
    socket.destroy();
    await sleep(300);

    expect(state.cancelled).toBe(true);
    await app.close();
  });

  it("survives a malformed request line and keeps serving", async () => {
    const app = await createHttpApplication(StreamModule);
    const { port } = await app.listen(0, "127.0.0.1");

    const socket = connect(port, "127.0.0.1");
    const reply = await new Promise<string>((resolve) => {
      let received = "";
      socket.on("data", (chunk) => {
        received += chunk.toString();
      });
      socket.on("close", () => {
        resolve(received);
      });
      socket.write("THIS IS NOT HTTP\r\n\r\n");
    });

    expect(reply).toContain("400");
    const ok = await fetch(`http://127.0.0.1:${port}/stream/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
    expect(await ok.json()).toEqual({ ok: true });
    await app.close();
  });

  it("answers 400 for an invalid JSON body and 415 for the wrong content type, without dropping the server", async () => {
    const app = await createHttpApplication(StreamModule);
    const { port } = await app.listen(0, "127.0.0.1");
    const url = `http://127.0.0.1:${port}/stream/echo`;

    const badJson = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
    const badType = await fetch(url, { method: "POST", headers: { "content-type": "text/plain" }, body: "hi" });

    expect(badJson.status).toBe(400);
    expect(badType.status).toBe(415);
    await app.close();
  });

  it("survives a response stream that errors after the headers were sent, and keeps serving", async () => {
    const app = await createHttpApplication(StreamModule);
    const { port } = await app.listen(0, "127.0.0.1");

    const broken = await fetch(`http://127.0.0.1:${port}/stream/explode`).then(
      (res) => res.text(),
      (error: unknown) => error,
    );

    expect(broken === "partial" || broken instanceof Error).toBe(true);
    const ok = await fetch(`http://127.0.0.1:${port}/stream/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ still: "up" }),
    });
    expect(await ok.json()).toEqual({ still: "up" });
    await app.close();
  });

  it("survives a client that aborts halfway through uploading a body, and keeps serving", async () => {
    const app = await createHttpApplication(StreamModule);
    const { port } = await app.listen(0, "127.0.0.1");

    const socket = connect(port, "127.0.0.1");
    socket.write(
      "POST /stream/echo HTTP/1.1\r\nhost: x\r\ncontent-type: application/json\r\ncontent-length: 1000\r\n\r\n{\"partial\":",
    );
    await sleep(100);
    socket.destroy();
    await sleep(200);

    const ok = await fetch(`http://127.0.0.1:${port}/stream/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ still: "up" }),
    });
    expect(await ok.json()).toEqual({ still: "up" });
    await app.close();
  });
});

describe("malformed HTTP over a real socket", () => {
  afterEach(() => {
    uploads.length = 0;
    vi.restoreAllMocks();
  });

  it("answers 431 for oversized request headers, and keeps serving", async () => {
    const app = await createHttpApplication(UploadModule);
    const { port } = await app.listen(0, "127.0.0.1");

    // Node's default maxHeaderSize is 16 KiB.
    const reply = await rawExchange(port, `GET /upload HTTP/1.1\r\nhost: x\r\nx-big: ${"a".repeat(20 * 1024)}\r\n\r\n`);

    expect(reply).toMatch(/^HTTP\/1\.1 431 /);
    await expectStillServing(port);
    await app.close();
  });

  it.each([
    ["a non-numeric Content-Length", "content-length: abc\r\n"],
    ["a negative Content-Length", "content-length: -1\r\n"],
    ["two conflicting Content-Length headers", "content-length: 2\r\ncontent-length: 3\r\n"],
    ["Content-Length together with Transfer-Encoding", "content-length: 2\r\ntransfer-encoding: chunked\r\n"],
  ])("answers 400 for %s without running the handler, and keeps serving", async (_name, headers) => {
    const app = await createHttpApplication(UploadModule);
    const { port } = await app.listen(0, "127.0.0.1");

    const reply = await rawExchange(port, `${JSON_POST}${headers}\r\n{}`);

    expect(reply).toMatch(/^HTTP\/1\.1 400 /);
    expect(uploads).toEqual([]);
    await expectStillServing(port);
    await app.close();
  });

  it("answers 400 when the client closes its side before sending the declared Content-Length, without logging a server error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await createHttpApplication(UploadModule);
    const { port } = await app.listen(0, "127.0.0.1");

    const socket = connect(port, "127.0.0.1");
    const reply = await new Promise<string>((resolve) => {
      let received = "";
      socket.on("data", (chunk) => {
        received += chunk.toString();
      });
      socket.on("close", () => {
        resolve(received);
      });
      socket.end(`${JSON_POST}content-length: 50\r\n\r\n{"a":1}`);
    });
    await sleep(200);

    expect(reply).toMatch(/^HTTP\/1\.1 400 /);
    expect(uploads).toEqual([]);
    expect(error).not.toHaveBeenCalled();
    await expectStillServing(port);
    await app.close();
  });

  it("answers 504 via requestTimeout when the declared Content-Length never arrives, and keeps serving", async () => {
    const app = await createHttpApplication(UploadModule, { requestTimeout: 200, shutdownTimeout: 200 });
    const { port } = await app.listen(0, "127.0.0.1");

    const reply = await rawExchange(port, `${JSON_POST}content-length: 50\r\n\r\n{"a":1}`, 600);

    expect(reply).toMatch(/^HTTP\/1\.1 504 /);
    expect(uploads).toEqual([]);
    await expectStillServing(port);
    await app.close();
  });

  it("reads only the declared Content-Length and rejects the surplus bytes as a bad next request, and keeps serving", async () => {
    const app = await createHttpApplication(UploadModule);
    const { port } = await app.listen(0, "127.0.0.1");

    const reply = await rawExchange(port, `${JSON_POST}content-length: 7\r\n\r\n{"a":1}SURPLUS BYTES\r\n\r\n`);

    // The handler got exactly the declared 7 bytes; Node parses the rest as the next pipelined request,
    // answers 400 and closes the connection (which may cut off the first response).
    expect(uploads).toEqual([{ a: 1 }]);
    expect(reply).toMatch(/HTTP\/1\.1 400 /);
    await expectStillServing(port);
    await app.close();
  });

  it("answers 413 to a chunked body over bodyLimit (no Content-Length) while the client is still sending, and keeps serving", async () => {
    const app = await createHttpApplication(UploadModule, { bodyLimit: 64, shutdownTimeout: 200 });
    const { port } = await app.listen(0, "127.0.0.1");

    const socket = connect(port, "127.0.0.1");
    let reply = "";
    socket.on("data", (chunk) => {
      reply += chunk.toString();
    });
    socket.write(`${JSON_POST}transfer-encoding: chunked\r\n\r\n`);
    // 32-byte chunks, never terminated: the limit is crossed on the third one.
    for (let i = 0; i < 4; i += 1) {
      socket.write(`20\r\n${"x".repeat(32)}\r\n`);
      await sleep(50);
    }
    await sleep(200);

    expect(reply).toMatch(/^HTTP\/1\.1 413 /);
    expect(reply).toContain('"title":"Payload Too Large"');
    expect(uploads).toEqual([]);
    socket.destroy();
    await expectStillServing(port);
    await app.close();
  });

  it.each([
    ["a Content-Length body", "content-length: 1000\r\n\r\n{\"partial\":"],
    ["a chunked body", "transfer-encoding: chunked\r\n\r\nb\r\n{\"partial\":\r\n"],
  ])("does not log a server error when the client disconnects mid-way through %s, and keeps serving", async (_name, rest) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await createHttpApplication(UploadModule);
    const { port } = await app.listen(0, "127.0.0.1");

    const socket = connect(port, "127.0.0.1");
    socket.write(`${JSON_POST}${rest}`);
    await sleep(100);
    socket.destroy();
    await sleep(200);

    expect(uploads).toEqual([]);
    expect(error).not.toHaveBeenCalled();
    await expectStillServing(port);
    await app.close();
  });
});
