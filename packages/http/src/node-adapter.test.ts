import { EventEmitter } from "node:events";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { sendWebResponse, toWebRequest } from "./node-adapter.js";

function mockIncomingMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    method: "GET",
    url: "/",
    headers: {},
    once: () => {},
    ...overrides,
  } as IncomingMessage;
}

function mockResponse(writableFinished: boolean): ServerResponse {
  return Object.assign(new EventEmitter(), { writableFinished }) as unknown as ServerResponse;
}

describe("toWebRequest: client disconnect", () => {
  it("aborts the signal when the response closes before it finished", () => {
    const res = mockResponse(false);
    const request = toWebRequest(mockIncomingMessage(), "http://localhost", res);

    res.emit("close");

    expect(request.signal.aborted).toBe(true);
  });

  it("leaves the signal alone when the response closes after finishing normally", () => {
    const res = mockResponse(true);
    const request = toWebRequest(mockIncomingMessage(), "http://localhost", res);

    res.emit("close");

    expect(request.signal.aborted).toBe(false);
  });
});

describe("toWebRequest", () => {
  it("builds a Request from the method, url, and headers", () => {
    const req = mockIncomingMessage({
      method: "GET",
      url: "/posts?limit=1",
      headers: { "x-trace": "abc" },
    });

    const request = toWebRequest(req, "http://localhost:3000");

    expect(request.method).toBe("GET");
    expect(request.url).toBe("http://localhost:3000/posts?limit=1");
    expect(request.headers.get("x-trace")).toBe("abc");
  });

  it("skips header entries with an undefined value instead of throwing", () => {
    const req = mockIncomingMessage({
      headers: { "x-present": "yes", "x-absent": undefined },
    });

    const request = toWebRequest(req, "http://localhost");

    expect(request.headers.get("x-present")).toBe("yes");
    expect(request.headers.has("x-absent")).toBe(false);
  });

  it("appends each value of a multi-value header separately", () => {
    const req = mockIncomingMessage({
      headers: { "x-multi": ["a", "b"] },
    });

    const request = toWebRequest(req, "http://localhost");

    expect(request.headers.get("x-multi")).toBe("a, b");
  });

  it("defaults to method GET and path / when the incoming message has neither", () => {
    const req = mockIncomingMessage({ method: undefined, url: undefined });

    const request = toWebRequest(req, "http://localhost");

    expect(request.method).toBe("GET");
    expect(request.url).toBe("http://localhost/");
  });

  it("gives GET/HEAD requests a null body even if headers claim otherwise", () => {
    const req = mockIncomingMessage({ method: "GET", headers: { "content-length": "5" } });

    const request = toWebRequest(req, "http://localhost");

    expect(request.body).toBeNull();
  });

  it("gives a bodyless POST (no content-length/transfer-encoding) a null body", () => {
    const req = mockIncomingMessage({ method: "POST", headers: {} });

    const request = toWebRequest(req, "http://localhost");

    expect(request.body).toBeNull();
  });
});

describe("sendWebResponse", () => {
  it("cancels the body and returns quietly when the client is already gone", async () => {
    const res = new ServerResponse(new IncomingMessage(new Socket()));
    res.destroy();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });

    await expect(sendWebResponse(new Response(body), res)).resolves.toBeUndefined();

    expect(cancelled).toBe(true);
  });
});
