import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { recordRemoteAddress } from "./remote-address.js";

/** What the client may tell the server about its own address. Everything is off by default: headers are client input. */
export interface OriginOptions {
  /**
   * Build `request.url`'s origin from the `Host` header (over `http`, since that is what this server speaks).
   * Without it the origin is the address the server listens on. Turn it on when clients reach the server directly
   * by its public name. Don't use `request.url` for security decisions or absolute links (password reset mails,
   * redirects) unless this is on and the header is trustworthy: a client can send any `Host`.
   */
  trustHostHeader?: boolean;
  /**
   * The server sits behind a reverse proxy or load balancer you control: take the scheme from `X-Forwarded-Proto` and
   * the host from `X-Forwarded-Host`, else `Host`. Implies `trustHostHeader`. Only enable it if the proxy overwrites
   * those headers, or any client can claim any origin.
   */
  trustProxy?: boolean;
}

/** A bare `host` or `host:port`: letters, digits, `-`, `_` and dots, or a bracketed IPv6 literal. No userinfo, path, query or scheme. */
const HOST_PATTERN = /^(?:[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;

/** The first value of a possibly repeated, possibly comma-separated header: what the proxy nearest the client appended. */
function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const first = (Array.isArray(value) ? value[0] : value)?.split(",")[0]?.trim();
  return first === undefined || first === "" ? undefined : first;
}

/** `http://host:port` for the address the server listens on, with an IPv6 host in brackets as a URL needs. */
export function listenOrigin(hostname: string, port: number): string {
  const host = hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
  return `http://${host}:${port}`;
}

/**
 * The origin (`scheme://host[:port]`) to build `request.url` from: `listen` unless an option says client headers may
 * be trusted, and then only values that look like a bare host (and `http`/`https` for the scheme). Anything else
 * falls back to `listen`, so a hostile header can't inject a path, userinfo or another scheme into the URL.
 */
export function resolveOrigin(req: IncomingMessage, listen: string, options: OriginOptions): string {
  const trustProxy = options.trustProxy === true;
  if (!trustProxy && options.trustHostHeader !== true) {
    return listen;
  }

  const forwardedHost = trustProxy ? firstHeaderValue(req.headers["x-forwarded-host"]) : undefined;
  const candidate = forwardedHost !== undefined && HOST_PATTERN.test(forwardedHost) ? forwardedHost : firstHeaderValue(req.headers.host);
  if (candidate === undefined || !HOST_PATTERN.test(candidate)) {
    return listen;
  }

  const forwardedProto = trustProxy ? firstHeaderValue(req.headers["x-forwarded-proto"])?.toLowerCase() : undefined;
  return `${forwardedProto === "https" ? "https" : "http"}://${candidate}`;
}

/**
 * Builds a Web-standard `Request` from a Node `IncomingMessage`, including a body stream and abort signal.
 * Pass the matching `ServerResponse` so the signal also fires when the client disconnects before the
 * response finished — `req`'s own "aborted" event is deprecated and misses some disconnects.
 */
export function toWebRequest(req: IncomingMessage, baseUrl: string, res?: ServerResponse): Request {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", baseUrl);

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue;
    }
    for (const one of Array.isArray(value) ? value : [value]) {
      headers.append(name, one);
    }
  }

  const controller = new AbortController();
  req.once("aborted", () => {
    controller.abort();
  });
  res?.once("close", () => {
    if (!res.writableFinished) {
      controller.abort();
    }
  });

  // GET/HEAD can never carry a body (Fetch spec forbids it on the Request
  // we're about to construct). Otherwise, trust the standard signals for
  // "the client is actually sending body bytes" rather than the method —
  // a bodyless POST is common and must not turn into an open, empty stream.
  const hasBody =
    method !== "GET" &&
    method !== "HEAD" &&
    (req.headers["transfer-encoding"] !== undefined ||
      (req.headers["content-length"] !== undefined && req.headers["content-length"] !== "0"));

  const request = new Request(url, {
    method,
    headers,
    signal: controller.signal,
    // `duplex: "half"` is required by Node's fetch implementation whenever body is a stream.
    ...(hasBody ? { body: Readable.toWeb(req), duplex: "half" as const } : {}),
  });
  recordRemoteAddress(request, req.socket.remoteAddress);
  return request;
}

/** Writes a Web-standard `Response` back onto a Node `ServerResponse`. */
export async function sendWebResponse(response: Response, res: ServerResponse): Promise<void> {
  // The client already disconnected (say, halfway through uploading its body): nobody is left to answer,
  // and piping into the destroyed socket would throw. Cancel the body so its producer stops as well.
  if (res.destroyed) {
    await response.body?.cancel();
    return;
  }

  const headers: Record<string, string[]> = {};
  for (const [name, value] of response.headers) {
    (headers[name] ??= []).push(value);
  }
  res.writeHead(response.status, headers);

  if (!response.body) {
    res.end();
    return;
  }

  // A plain reader loop, not `pipeline(Readable.fromWeb(body), res)`: `pipeline` builds an AbortController per call and
  // aborts it when it finishes, which creates a DOMException (with a stack trace) on **every** response. In a profile
  // that was about a tenth of the server's time for a small response. This keeps what `pipeline` gave us:
  // - backpressure: wait for `drain` when the socket is full;
  // - a client that disconnects mid-response cancels the body's source (a DB cursor, a file handle) and is not an error;
  // - an error from the body destroys the response and is thrown to the caller.
  const reader = response.body.getReader();
  const cancel = (): void => {
    reader.cancel().catch(() => {});
  };
  res.once("close", cancel);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || res.destroyed) {
        break;
      }
      if (!res.write(value)) {
        await drained(res);
      }
    }
    if (!res.destroyed) {
      res.end();
    }
  } catch (error) {
    res.destroy();
    throw error;
  } finally {
    res.off("close", cancel);
    if (res.destroyed) {
      cancel();
    }
  }
}

/** Resolves when the socket can take more, or when it is gone (a `drain` that will never come). */
function drained(res: ServerResponse): Promise<void> {
  /* v8 ignore start -- @preserve: defensive. The caller has just seen `res.destroyed` be false and `write` cannot destroy
  the response synchronously, so this is not reachable today; it is here because waiting for a `close` that has already
  happened would hang the request forever. */
  if (res.destroyed) {
    return Promise.resolve();
  }
  /* v8 ignore stop */
  return new Promise((resolve) => {
    const done = (): void => {
      res.off("drain", done);
      res.off("close", done);
      resolve();
    };
    res.once("drain", done);
    res.once("close", done);
  });
}
