import type { Class } from "@blixis-io/di";
import { currentRequestId } from "./request-id.js";

/** What went wrong and where, handed to `onError`. */
export interface ErrorReport {
  /** The thrown value: a handler's unexpected error, a boot failure, a write that failed after the response was built. */
  error: unknown;
  /**
   * `"request"`: an unexpected error while serving a request (a controller, a guard, a mounted handler, a middleware),
   * answered with a generic 500. `"boot"`: the application failed to start (`createFetchHandler`). `"shutdown"`: a
   * shutdown hook failed while rolling back a failed boot.
   */
  phase: "request" | "boot" | "shutdown";
  /** A short description, set where the error alone does not say what was being done. */
  message?: string;
  /** The request being served, when there was one. */
  request?: Request;
  /** The matched route, when the error came from one. Unset for a middleware, a mounted handler or a router refusal. */
  route?: { controller: Class; handler: string | symbol };
  /** The id the `requestId()` middleware gave the request, when that middleware is in use. */
  requestId?: string;
}

export type ErrorReporter = (report: ErrorReport) => void;

/**
 * Where unexpected errors go. Without `onError` they are written with `console.error` (the error first, as before);
 * with it the application decides, and gets the request, the route and the request id with each error. A client never
 * sees the error either way: it gets a generic 500. A reporter that throws must not turn one failure into two, so it
 * is caught and its own failure is written to `console.error`.
 */
export function createErrorReporter(onError: ErrorReporter | undefined): ErrorReporter {
  return (report) => {
    const requestId = report.requestId ?? currentRequestId();
    const full = requestId === undefined ? report : { ...report, requestId };
    if (!onError) {
      if (full.message === undefined) {
        console.error(full.error);
      } else {
        console.error(full.message, full.error);
      }
      return;
    }
    try {
      onError(full);
    } catch (reporterError) {
      console.error("[@blixis-io/http] onError threw while reporting an error:", reporterError);
      console.error(full.error);
    }
  };
}
