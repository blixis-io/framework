import { createApplication, Module, type Application, type CreateApplicationOptions, type ModuleRef } from "@blixis-io/core";
import type { Class, Token } from "@blixis-io/di";
import { createServer, type Server } from "node:http";
import { createHandler, type HandlerOptions } from "./handler.js";
import { sendWebResponse, toWebRequest } from "./node-adapter.js";
import { RequestContext } from "./request-context.js";

export type HttpApplicationOptions = HandlerOptions & CreateApplicationOptions;

/** Provides `RequestContext` app-wide, without the user needing to import anything — every `createHttpApplication` root gets wrapped with this. */
@Module({ providers: [RequestContext], exports: [RequestContext], global: true })
class RequestContextModule {}

/** Empty static anchor for the synthetic root — its own metadata is unused, only `imports` matters. */
@Module()
class HttpRootModule {}

export interface ListenHandle {
  port: number;
}

/** The core `Application` plus a request handler, optionally bound to a real Node HTTP socket. */
export class HttpApplication {
  readonly #app: Application;
  readonly #handle: (request: Request) => Promise<Response>;
  #server: Server | undefined;

  private constructor(app: Application, handle: (request: Request) => Promise<Response>) {
    this.#app = app;
    this.#handle = handle;
  }

  static async create(rootModule: ModuleRef, options: HttpApplicationOptions = {}): Promise<HttpApplication> {
    const wrappedRoot = { module: HttpRootModule, imports: [rootModule, RequestContextModule] };
    const app = await createApplication(wrappedRoot, { overrides: options.overrides });
    const handle = createHandler(app.controllers, app, options);
    return new HttpApplication(app, handle);
  }

  /** Fetches an already-resolved provider directly, bypassing HTTP entirely. */
  get<T>(token: Token<T>): T {
    return this.#app.get(token);
  }

  /** Every controller class in this app's module graph — what `@blixis-io/openapi` walks to build a document that stays in sync with the real running app. */
  get controllers(): readonly Class[] {
    return this.#app.controllers;
  }

  /** Runs a request through the handler in-process, without a socket. */
  handle(request: Request): Promise<Response> {
    return this.#handle(request);
  }

  listen(port: number, hostname = "0.0.0.0"): Promise<ListenHandle> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const request = toWebRequest(req, `http://${hostname}:${port}`);
        this.#handle(request)
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

      server.once("error", reject);
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

  async close(signal?: string): Promise<void> {
    if (this.#server) {
      const server = this.#server;
      // Cleared before closing, not after: makes close() idempotent (a
      // second call is a no-op instead of ERR_SERVER_NOT_RUNNING) even if
      // the close below is still in flight.
      this.#server = undefined;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
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
