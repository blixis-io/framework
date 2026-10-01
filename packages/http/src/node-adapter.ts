import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

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

  return new Request(url, {
    method,
    headers,
    signal: controller.signal,
    // `duplex: "half"` is required by Node's fetch implementation whenever body is a stream.
    ...(hasBody ? { body: Readable.toWeb(req), duplex: "half" as const } : {}),
  });
}

/** Writes a Web-standard `Response` back onto a Node `ServerResponse`. */
export async function sendWebResponse(response: Response, res: ServerResponse): Promise<void> {
  const headers: Record<string, string[]> = {};
  for (const [name, value] of response.headers) {
    (headers[name] ??= []).push(value);
  }
  res.writeHead(response.status, headers);

  if (!response.body) {
    res.end();
    return;
  }

  const body = Readable.fromWeb(response.body);
  await new Promise<void>((resolve, reject) => {
    res.once("finish", resolve);
    res.once("error", reject);
    body.once("error", reject);
    body.pipe(res);
  });
}
