import { Module } from "@blixis-io/core";
import { connect } from "node:net";
import { describe, expect, it } from "vitest";
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
