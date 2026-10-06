import { EventEmitter } from "node:events";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { listenOrigin, resolveOrigin, sendWebResponse, toWebRequest } from "./node-adapter.js";
import { normalizeAddress, remoteAddressOf } from "./remote-address.js";

function mockIncomingMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    method: "GET",
    url: "/",
    headers: {},
    socket: { remoteAddress: undefined },
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

const withHeaders = (headers: Record<string, string | string[]>) => mockIncomingMessage({ headers });

describe("resolveOrigin", () => {
  const listen = "http://127.0.0.1:3000";

  it("uses the listen address and ignores every client header by default", () => {
    const req = withHeaders({ host: "evil.example.com", "x-forwarded-host": "evil.example.com", "x-forwarded-proto": "https" });

    expect(resolveOrigin(req, listen, {})).toBe(listen);
  });

  describe("with trustHostHeader", () => {
    it("takes the origin from the Host header, over http", () => {
      expect(resolveOrigin(withHeaders({ host: "api.example.com" }), listen, { trustHostHeader: true })).toBe("http://api.example.com");
      expect(resolveOrigin(withHeaders({ host: "api.example.com:8080" }), listen, { trustHostHeader: true })).toBe("http://api.example.com:8080");
      expect(resolveOrigin(withHeaders({ host: "[::1]:3000" }), listen, { trustHostHeader: true })).toBe("http://[::1]:3000");
    });

    it("still ignores the forwarded headers", () => {
      const req = withHeaders({ host: "api.example.com", "x-forwarded-host": "other.example.com", "x-forwarded-proto": "https" });

      expect(resolveOrigin(req, listen, { trustHostHeader: true })).toBe("http://api.example.com");
    });

    it("falls back to the listen address when Host is missing", () => {
      expect(resolveOrigin(withHeaders({}), listen, { trustHostHeader: true })).toBe(listen);
    });

    it.each(["evil.com/path", "user@evil.com", "evil.com?x=1", "a b", "evil.com#frag", "", "evil.com:port", "-", "evil..com\\x", "http://evil.com"])(
      "ignores a Host value that is not a bare host[:port]: %j",
      (host) => {
        expect(resolveOrigin(withHeaders({ host }), listen, { trustHostHeader: true })).toBe(listen);
      },
    );
  });

  describe("with trustProxy", () => {
    it("takes scheme and host from X-Forwarded-Proto and X-Forwarded-Host", () => {
      const req = withHeaders({ host: "internal:3000", "x-forwarded-host": "shop.example.com", "x-forwarded-proto": "https" });

      expect(resolveOrigin(req, listen, { trustProxy: true })).toBe("https://shop.example.com");
    });

    it("uses the first value when a chain of proxies appended several", () => {
      const req = withHeaders({ "x-forwarded-host": "shop.example.com, internal.lb", "x-forwarded-proto": "https, http" });

      expect(resolveOrigin(req, listen, { trustProxy: true })).toBe("https://shop.example.com");
    });

    it("falls back to the Host header when no forwarded host is sent", () => {
      expect(resolveOrigin(withHeaders({ host: "api.example.com", "x-forwarded-proto": "https" }), listen, { trustProxy: true })).toBe("https://api.example.com");
    });

    it("ignores a scheme that is not http or https", () => {
      expect(resolveOrigin(withHeaders({ host: "api.example.com", "x-forwarded-proto": "javascript" }), listen, { trustProxy: true })).toBe("http://api.example.com");
    });

    it("falls back to the listen address when neither header is usable", () => {
      expect(resolveOrigin(withHeaders({ "x-forwarded-host": "evil.com/x" }), listen, { trustProxy: true })).toBe(listen);
    });
  });
});

describe("listenOrigin", () => {
  it("joins host and port", () => {
    expect(listenOrigin("127.0.0.1", 3000)).toBe("http://127.0.0.1:3000");
    expect(listenOrigin("localhost", 8080)).toBe("http://localhost:8080");
  });

  it("brackets an IPv6 host, which `new URL` needs: http://::1:3000 is not a URL", () => {
    expect(listenOrigin("::1", 3000)).toBe("http://[::1]:3000");
    expect(new URL("/x", listenOrigin("::1", 3000)).href).toBe("http://[::1]:3000/x");
    expect(listenOrigin("[::1]", 3000)).toBe("http://[::1]:3000");
  });
});

const socketWith = (remoteAddress: string | undefined) => ({ socket: { remoteAddress } }) as Partial<IncomingMessage>;

describe("toWebRequest: the peer's address", () => {
  it("records the address of the socket the request arrived on", () => {
    const request = toWebRequest(mockIncomingMessage(socketWith("203.0.113.7")), "http://localhost");

    expect(remoteAddressOf(request)).toBe("203.0.113.7");
  });

  it("records nothing when the socket has no address (it already closed)", () => {
    expect(remoteAddressOf(toWebRequest(mockIncomingMessage(socketWith(undefined)), "http://localhost"))).toBeUndefined();
  });

  it("writes an IPv4 peer of a dual-stack socket the plain way", () => {
    expect(remoteAddressOf(toWebRequest(mockIncomingMessage(socketWith("::ffff:203.0.113.7")), "http://localhost"))).toBe("203.0.113.7");
  });

  it("knows no peer for a request it did not build", () => {
    expect(remoteAddressOf(new Request("http://localhost/"))).toBeUndefined();
  });
});

describe("normalizeAddress", () => {
  it.each([
    ["::ffff:10.0.0.1", "10.0.0.1"],
    ["::FFFF:10.0.0.1", "10.0.0.1"],
    ["10.0.0.1", "10.0.0.1"],
    ["2001:db8::1", "2001:db8::1"],
    ["::1", "::1"],
    ["::ffff:0:1", "::ffff:0:1"],
  ])("%s becomes %s", (input, expected) => {
    expect(normalizeAddress(input)).toBe(expected);
  });
});
