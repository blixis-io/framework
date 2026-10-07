import { createApplication, Module, type Application, type CreateApplicationOptions, type ModuleRef } from "@blixis-io/core";
import type { Class, Token } from "@blixis-io/di";
import { createServer, type Server } from "node:http";
import { createErrorReporter, type ErrorReporter } from "./error-report.js";
import { createHandler, exceptionToResponse, runWithDeadline, type HandlerOptions } from "./handler.js";
import { listenOrigin, resolveOrigin, sendWebResponse, toWebRequest, type OriginOptions } from "./node-adapter.js";
import { RequestContext, runInUnclaimedRequestContext } from "./request-context.js";
import { REMOTE_ADDRESS_KEY, remoteAddressOf } from "./remote-address.js";

const DEFAULT_SHUTDOWN_TIMEOUT = 10_000;

export interface ShutdownOptions {
  /**
   * Milliseconds `close()` lets in-flight requests finish before their sockets are destroyed (their
   * `request.signal` aborts). Default 10 000; `Infinity` waits indefinitely.
   */
  shutdownTimeout?: number;
}

/** Calls the rest of the chain (the next middleware, finally the application) and resolves with its `Response`. Pass a `Request` to hand a changed one on; without one the current request goes on unchanged. Call it at most once. */
export type NextFunction = (request?: Request) => Promise<Response>;

/**
 * Code that runs around every request: routed, mounted, and the ones the router refuses (404, 405, malformed path).
 * Return the `Response` from `next()` (changed or not), or return one of your own without calling it. Throwing an
 * `HttpException` answers with that exception's problem+json; any other error is logged and answers a generic 500.
 */
export type Middleware = (request: Request, next: NextFunction) => Response | Promise<Response>;

export interface MiddlewareOptions {
  /**
   * Outermost first. A middleware sees the `Response` the application produced, not the end of its body stream, and
   * runs inside a request scope (`RequestContext`) that the guards and the controller then share. It sits outside
   * `requestTimeout`: the deadline covers the application, not the middleware.
   */
  middleware?: readonly Middleware[];
}

interface HttpApplicationSettings {
  shutdownTimeout: number;
  origin: OriginOptions;
  requestTimeout: number | undefined;
  middleware: readonly Middleware[];
  report: ErrorReporter;
}

export type HttpApplicationOptions = HandlerOptions & CreateApplicationOptions & ShutdownOptions & OriginOptions & MiddlewareOptions;

/**
 * Provides `RequestContext` app-wide, without the user needing to import anything — every `createHttpApplication` root gets wrapped with this.
 * Exported for entry points that boot the app without the HTTP layer (`blix run`), so providers that inject `RequestContext` still resolve there.
 */
@Module({ providers: [RequestContext], exports: [RequestContext], global: true })
export class RequestContextModule {}

/** Empty static anchor for the synthetic root — its own metadata is unused, only `imports` matters. */
@Module()
class HttpRootModule {}

export type MountedHandler = (request: Request) => Response | Promise<Response>;

export interface ListenHandle {
  port: number;
}

/** The core `Application` plus a request handler, optionally bound to a real Node HTTP socket. */
export class HttpApplication {
  readonly #app: Application;
  readonly #handle: (request: Request) => Promise<Response>;
  readonly #shutdownTimeout: number;
  readonly #requestTimeout: number | undefined;
  readonly #middleware: readonly Middleware[];
  readonly #report: ErrorReporter;
  readonly #context = new RequestContext();
  readonly #origin: OriginOptions;
  readonly #mounted = new Map<string, MountedHandler>();
  #server: Server | undefined;
  #listening = false;
  #closing: Promise<void> | undefined;
  #draining = false;

  private constructor(app: Application, handle: (request: Request) => Promise<Response>, settings: HttpApplicationSettings) {
    this.#app = app;
    this.#handle = handle;
    this.#shutdownTimeout = settings.shutdownTimeout;
    this.#origin = settings.origin;
    this.#requestTimeout = settings.requestTimeout;
    this.#middleware = settings.middleware;
    this.#report = settings.report;
  }

  static async create(rootModule: ModuleRef, options: HttpApplicationOptions = {}): Promise<HttpApplication> {
    const wrappedRoot = { module: HttpRootModule, imports: [rootModule, RequestContextModule] };
    const report = createErrorReporter(options.onError);
    const app = await createApplication(wrappedRoot, {
      overrides: options.overrides,
      // A shutdown hook failing while a failed boot is rolled back goes where every other unexpected error goes.
      onRollbackError: (error) => {
        report({ error, phase: "shutdown", message: "[@blixis-io/core] an onApplicationShutdown hook failed while rolling back a failed boot:" });
      },
    });
    let handle: (request: Request) => Promise<Response>;
    try {
      handle = createHandler(app.controllers, app, options);
    } catch (error) {
      // The core application is already up (pools open, hooks run) and nobody holds it yet, so nobody else can close it.
      // The boot's own error is what the caller needs to see; a failing shutdown hook is reported, not thrown over it.
      await app.close().catch((closeError: unknown) => {
        report({
          error: closeError,
          phase: "shutdown",
          message: "[@blixis-io/http] an onApplicationShutdown hook failed while rolling back a failed boot:",
        });
      });
      throw error;
    }
    return new HttpApplication(app, handle, {
      shutdownTimeout: options.shutdownTimeout ?? DEFAULT_SHUTDOWN_TIMEOUT,
      origin: {
        ...(options.trustHostHeader === undefined ? {} : { trustHostHeader: options.trustHostHeader }),
        ...(options.trustProxy === undefined ? {} : { trustProxy: options.trustProxy }),
      },
      requestTimeout: options.requestTimeout,
      middleware: [...(options.middleware ?? [])],
      report,
    });
  }

  /** Fetches an already-resolved provider directly, bypassing HTTP entirely. */
  get<T>(token: Token<T>): T {
    return this.#app.get(token);
  }

  /** Every controller class in this app's module graph — what `@blixis-io/openapi` walks to build a document that stays in sync with the real running app. */
  get controllers(): readonly Class[] {
    return this.#app.controllers;
  }

  /**
   * Serves an exact path with a plain Web-standard handler, ahead of the controller router — for
   * framework-level endpoints (such as an OpenAPI document) that need the finished app, which a
   * controller can't get at construction time. Mounted routes bypass guards and interceptors, so
   * they are public, but they do get the `requestTimeout` deadline; mounting the same method and path twice throws.
   */
  mount(method: "GET" | "POST", path: string, handler: MountedHandler): void {
    const key = `${method} ${path}`;
    if (this.#mounted.has(key)) {
      throw new Error(`${key} is already mounted`);
    }
    this.#mounted.set(key, handler);
  }

  /** Runs a request through the middleware and the handler in-process, without a socket. */
  handle(request: Request): Promise<Response> {
    const peer = remoteAddressOf(request);
    if (this.#middleware.length === 0 && peer === undefined) {
      return this.#dispatch(request);
    }
    // One request scope around everything, which the handler adopts: what the middleware stores, and the address of the
    // peer that connected, are what the guards and the controller read.
    return runInUnclaimedRequestContext(() => {
      if (peer !== undefined) {
        this.#context.set(REMOTE_ADDRESS_KEY, peer);
      }
      return this.#middleware.length === 0 ? this.#dispatch(request) : this.#throughMiddleware(request);
    });
  }

  /** The mounted handler for this request, or the router. */
  async #dispatch(request: Request): Promise<Response> {
    if (this.#mounted.size > 0) {
      const mounted = this.#mounted.get(`${request.method} ${new URL(request.url).pathname}`);
      if (mounted) {
        return runWithDeadline(request, this.#requestTimeout, async (timed) => mounted(timed));
      }
    }
    return this.#handle(request);
  }

  async #throughMiddleware(request: Request): Promise<Response> {
    const run = async (index: number, current: Request): Promise<Response> => {
      const middleware = this.#middleware[index];
      if (!middleware) {
        // A failure inside the application is a response here, as it already is for a routed request, so every middleware sees it the same way.
        return this.#dispatch(current).catch((error: unknown) => exceptionToResponse(error, (unexpected) => this.#report({ error: unexpected, phase: "request", request: current })));
      }
      let called = false;
      try {
        const response = await middleware(current, (next = current) => {
          if (called) {
            throw new Error("A middleware called next() more than once.");
          }
          called = true;
          return run(index + 1, next);
        });
        if (!(response instanceof Response)) {
          throw new TypeError("A middleware must return a Response (the one from next(), or its own).");
        }
        return response;
      } catch (error) {
        // A failure in this middleware is a response for the one outside it, just like a failure in the application: so
        // `next()` never rejects, and a CORS or logging middleware further out still sees (and can decorate) the 429
        // a rate limiter threw, or the 500 a broken middleware caused.
        return exceptionToResponse(error, (unexpected) => this.#report({ error: unexpected, phase: "request", request: current }));
      }
    };
    return run(0, request);
  }

  listen(port: number, hostname = "0.0.0.0"): Promise<ListenHandle> {
    if (this.#closing) {
      return Promise.reject(new Error("This application is closed; create a new one to listen again."));
    }
    if (this.#listening) {
      return Promise.reject(new Error("This application is already listening; call close() before listening again."));
    }
    this.#listening = true;
    return new Promise((resolve, reject) => {
      // Built on the first request and kept: the address cannot change once the server is listening, and asking for it
      // and formatting it on every request was measurable (about 2% of the server's time in a profile).
      let listening: string | undefined;
      const server = createServer((req, res) => {
        if (listening === undefined) {
          // The port actually bound, not the one asked for: listen(0) picks a free one.
          const bound = server.address();
          listening = listenOrigin(hostname, typeof bound === "object" && bound !== null ? bound.port : port);
        }
        const request = toWebRequest(req, resolveOrigin(req, listening, this.#origin), res);
        this.handle(request)
          .then((response) => sendWebResponse(response, res))
          /* v8 ignore start -- @preserve: safety net for a write failure
          (e.g. the client disconnects mid-stream); createHandler's own
          try/catch already turns every request-handling error into a
          Response, so this only fires for socket-level failures, which
          aren't reliably reproducible without a flaky, timing-dependent
          test. */
          .catch((error: unknown) => {
            this.#report({ error, phase: "request", request });
            if (!res.headersSent) {
              res.writeHead(500);
            }
            res.end();
          });
          /* v8 ignore stop */
      });

      const onStartError = (error: Error): void => {
        this.#listening = false;
        reject(error);
      };
      server.once("error", onStartError);
      server.listen(port, hostname, () => {
        this.#server = server;
        // From here on an `error` event is not a failed start. Without a listener Node would throw it as an uncaught
        // exception (running out of file descriptors, say) and take the process down with every request in flight.
        server.off("error", onStartError);
        server.on("error", (error) => {
          this.#report({ error, phase: "server", message: "[@blixis-io/http] the server reported an error:" });
        });
        const address = server.address();
        // `address()` only returns a string for a Unix domain socket; `listen()`
        // here always takes a TCP port, so that arm is unreachable in practice.
        /* v8 ignore next -- @preserve */
        const actualPort = typeof address === "object" && address !== null ? address.port : port;
        resolve({ port: actualPort });
      });
    });
  }

  /**
   * `true` from the moment `close()` is called, or `startDraining()`, onward. A readiness check reports "not ready" while
   * this is `true`, so a load balancer stops sending traffic to an instance that is about to go away.
   */
  get draining(): boolean {
    return this.#draining || this.#closing !== undefined;
  }

  /**
   * Marks the application as draining without closing anything: it keeps serving, but `draining` is `true`. Call it when
   * a shutdown signal arrives, wait for the load balancer to notice (its health-check interval), then `close()`.
   * Closing first would refuse new connections before the balancer knew to stop using this instance.
   */
  startDraining(): void {
    this.#draining = true;
  }

  /**
   * Stops accepting connections, waits for in-flight requests (up to `shutdownTimeout`), then runs the shutdown hooks.
   * Every call returns the same promise, so a second caller (a signal handler and a test's cleanup, say) waits for the
   * same drain instead of tearing the application down under requests that are still running. The `signal` of the
   * first call is the one the hooks see.
   */
  close(signal?: string): Promise<void> {
    this.#closing ??= this.#shutDown(signal);
    return this.#closing;
  }

  async #shutDown(signal: string | undefined): Promise<void> {
    const server = this.#server;
    if (server) {
      this.#server = undefined;
      await new Promise<void>((resolve, reject) => {
        // Stops accepting new connections and waits for in-flight requests;
        // idle keep-alive sockets are dropped now so they can't hold close()
        // open. Anything still running at the deadline is cut off.
        const deadline = Number.isFinite(this.#shutdownTimeout)
          ? setTimeout(() => {
              server.closeAllConnections();
            }, this.#shutdownTimeout)
          : undefined;
        server.close((error) => {
          clearTimeout(deadline);
          // #server is only ever set right after a successful listen() and
          // cleared right before this close(), so ERR_SERVER_NOT_RUNNING
          // (the one realistic cause) can't occur here.
          /* v8 ignore next 3 -- @preserve */
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
        server.closeIdleConnections();
      });
    }
    await this.#app.close(signal);
  }
}

export async function createHttpApplication(
  rootModule: ModuleRef,
  options: HttpApplicationOptions = {},
): Promise<HttpApplication> {
  return HttpApplication.create(rootModule, options);
}
