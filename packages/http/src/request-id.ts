import { RequestContext } from "./request-context.js";
import type { Middleware } from "./http-application.js";

/** The `RequestContext` key the `requestId()` middleware stores the id under. */
export const REQUEST_ID_KEY = "blixis.http.request-id";

const context = new RequestContext();

/** The current request's id, if `requestId()` is in use and a request is being served. */
export function currentRequestId(): string | undefined {
  return context.get<string>(REQUEST_ID_KEY);
}

/** Letters, digits and `._:-`, up to 128 characters: enough for UUIDs, ULIDs and trace ids, too little to smuggle anything into a log line. */
const VALID_ID = /^[\w.:-]{1,128}$/;

export interface RequestIdOptions {
  /** Request and response header carrying the id. Default `x-request-id`. */
  header?: string;
  /** Makes an id when the request has none (or none that is acceptable). Default `crypto.randomUUID()`. */
  generate?: () => string;
  /**
   * Whether an id the client sent is kept. Default `true`, which lets a caller correlate its own logs with yours; an
   * id is only kept if it is a short token (see above). Turn it off when clients are not to be trusted to name requests.
   */
  trustIncoming?: boolean;
}

/**
 * Gives every request an id: the client's `x-request-id` when it sent an acceptable one, else a new one. The id is
 * stored in the `RequestContext` (read it with `currentRequestId()`; `onError` reports and `accessLog()` entries carry
 * it) and set on the response, including on a `404` or a guard's `403`. Put it first in `middleware`.
 */
export function requestId(options: RequestIdOptions = {}): Middleware {
  const header = options.header ?? "x-request-id";
  const generate = options.generate ?? (() => crypto.randomUUID());
  const trustIncoming = options.trustIncoming ?? true;
  return async (request, next) => {
    const incoming = trustIncoming ? request.headers.get(header) : null;
    const id = incoming !== null && VALID_ID.test(incoming) ? incoming : generate();
    context.set(REQUEST_ID_KEY, id);
    return withResponseHeaders(await next(), { [header]: id });
  };
}

/**
 * The response with `headers` set. Some responses have immutable headers (`Response.redirect()`, one returned by
 * `fetch()`), and `response.headers.set()` throws on those, so a copy is made when needed. Use it in a middleware that
 * adds headers to whatever the application returned.
 */
export function withResponseHeaders(response: Response, headers: Readonly<Record<string, string>>): Response {
  try {
    for (const [name, value] of Object.entries(headers)) {
      response.headers.set(name, value);
    }
    return response;
  } catch {
    const copy = new Headers(response.headers);
    for (const [name, value] of Object.entries(headers)) {
      copy.set(name, value);
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: copy });
  }
}
