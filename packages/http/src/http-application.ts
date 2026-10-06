import { createApplication, Module, type Application, type CreateApplicationOptions, type ModuleRef } from "@blixis-io/core";
import type { Class, Token } from "@blixis-io/di";
import { createServer, type Server } from "node:http";
import { createHandler, runWithDeadline, type HandlerOptions } from "./handler.js";
import { listenOrigin, resolveOrigin, sendWebResponse, toWebRequest, type OriginOptions } from "./node-adapter.js";
import { RequestContext } from "./request-context.js";

const DEFAULT_SHUTDOWN_TIMEOUT = 10_000;

export interface ShutdownOptions {
  /**
   * Milliseconds `close()` lets in-flight requests finish before their sockets are destroyed (their
   * `request.signal` aborts). Default 10 000; `Infinity` waits indefinitely.
   */
  shutdownTimeout?: number;
}

export type HttpApplicationOptions = HandlerOptions & CreateApplicationOptions & ShutdownOptions & OriginOptions;

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
  readonly #origin: OriginOptions;
  readonly #mounted = new Map<string, MountedHandler>();
  #server: Server | undefined;
  #listening = false;
  #closing: Promise<void> | undefined;

  private constructor(
    app: Application,
    handle: (request: Request) => Promise<Response>,
    shutdownTimeout: number,
    origin: OriginOptions,
    requestTimeout: number | undefined,
  ) {
    this.#app = app;
    this.#handle = handle;
    this.#shutdownTimeout = shutdownTimeout;
    this.#origin = origin;
    this.#requestTimeout = requestTimeout;
  }

  static async create(rootModule: ModuleRef, options: HttpApplicationOptions = {}): Promise<HttpApplication> {
    const wrappedRoot = { module: HttpRootModule, imports: [rootModule, RequestContextModule] };
    const app = await createApplication(wrappedRoot, { overrides: options.overrides });
    let handle: (request: Request) => Promise<Response>;
    try {
      handle = createHandler(app.controllers, app, options);
    } catch (error) {
      // The core application is already up (pools open, hooks run) and nobody holds it yet, so nobody else can close it.
      // The boot's own error is what the caller needs to see; a failing shutdown hook is logged, not thrown over it.
      await app.close().catch((closeError: unknown) => {
        console.error("[@blixis-io/http] an onApplicationShutdown hook failed while rolling back a failed boot:", closeError);
      });
      throw error;
    }
    return new HttpApplication(app, handle, options.shutdownTimeout ?? DEFAULT_SHUTDOWN_TIMEOUT, {
      ...(options.trustHostHeader === undefined ? {} : { trustHostHeader: options.trustHostHeader }),
      ...(options.trustProxy === undefined ? {} : { trustProxy: options.trustProxy }),
    }, options.requestTimeout);
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

  /** Runs a request through the handler in-process, without a socket. */
  async handle(request: Request): Promise<Response> {
    if (this.#mounted.size > 0) {
      const mounted = this.#mounted.get(`${request.method} ${new URL(request.url).pathname}`);
      if (mounted) {
        return runWithDeadline(request, this.#requestTimeout, async (timed) => mounted(timed));
      }
    }
    return this.#handle(request);
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
      const server = createServer((req, res) => {
        // The port actually bound, not the one asked for: listen(0) picks a free one.
        const bound = server.address();
        const boundPort = typeof bound === "object" && bound !== null ? bound.port : port;
        const request = toWebRequest(req, resolveOrigin(req, listenOrigin(hostname, boundPort), this.#origin), res);
        this.handle(request)
          .then((response) => sendWebResponse(response, res))
          /* v8 ignore start -- @preserve: safety net for a write failure
          (e.g. the client disconnects mid-stream); createHandler's own
          try/catch already turns every request-handling error into a
          Response, so this only fires for socket-level failures, which
          aren't reliably reproducible without a flaky, timing-dependent
          test. */
          .catch((error: unknown) => {
            console.error(error);
            if (!res.headersSent) {
              res.writeHead(500);
            }
            res.end();
          });
          /* v8 ignore stop */
      });

      server.once("error", (error) => {
        this.#listening = false;
        reject(error);
      });
      server.listen(port, hostname, () => {
        this.#server = server;
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
