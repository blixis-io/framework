import type { Middleware } from "./http-application.js";
import { currentRequestId } from "./request-id.js";

export interface AccessLogEntry {
  method: string;
  /** The path only: the query string can carry tokens and personal data, so it is left out. */
  path: string;
  status: number;
  /** Milliseconds from the middleware receiving the request to the response being created (not to the last byte of a streamed body). */
  durationMs: number;
  /** The id from `requestId()`, when that middleware ran before this one. */
  requestId?: string;
}

export interface AccessLogOptions {
  /** Receives one entry per request. Write it with your logger. A throw here is caught: logging never fails a request. */
  log: (entry: AccessLogEntry) => void;
}

/**
 * One entry per request: method, path, status, time and request id. No headers and no bodies, which is where secrets
 * live. Covers every request, including a `404`, a `405` and a guard's `403`. Put it after `requestId()`.
 */
export function accessLog(options: AccessLogOptions): Middleware {
  return async (request, next) => {
    const started = performance.now();
    const write = (status: number): void => {
      const id = currentRequestId();
      const entry: AccessLogEntry = {
        method: request.method,
        path: new URL(request.url).pathname,
        status,
        durationMs: performance.now() - started,
        ...(id === undefined ? {} : { requestId: id }),
      };
      try {
        options.log(entry);
      } catch (error) {
        console.error("[@blixis-io/http] the accessLog() log function threw:", error);
      }
    };
    try {
      const response = await next();
      write(response.status);
      return response;
    } catch (error) {
      // A middleware further in threw; the application answers that as a 500 after this.
      write(500);
      throw error;
    }
  };
}
