import type { ModuleRef } from "@blixis-io/core";
import { createErrorReporter } from "./error-report.js";
import { createHttpApplication, type HttpApplication, type HttpApplicationOptions } from "./http-application.js";

/** A Web-standard entry for platforms that call `fetch(request)` per request (Vercel, Netlify, Cloudflare Workers, Deno Deploy, ...). */
export interface FetchHandler {
  fetch(request: Request): Promise<Response>;
  /** Runs shutdown hooks. Serverless platforms rarely call this; it exists for tests and long-lived hosts. */
  close(signal?: string): Promise<void>;
}

/**
 * Boots the application lazily on the first request and reuses it afterwards, so a cold start pays for
 * module resolution once, not per request. Concurrent first requests share one boot. If boot fails the
 * error is logged, that request gets a generic 500, and the next request tries again instead of caching
 * the failure for the lifetime of the instance.
 *
 * ```ts
 * export default createFetchHandler(AppModule); // Vercel / Workers: `{ fetch }`
 * ```
 *
 * `listen()`, `shutdownTimeout` and `SIGTERM` handling don't apply here: the platform owns the socket.
 */
export function createFetchHandler(rootModule: ModuleRef, options: HttpApplicationOptions = {}): FetchHandler {
  let app: Promise<HttpApplication> | undefined;
  const report = createErrorReporter(options.onError);

  function boot(): Promise<HttpApplication> {
    app ??= createHttpApplication(rootModule, options).catch((error: unknown) => {
      app = undefined;
      throw error;
    });
    return app;
  }

  return {
    async fetch(request) {
      let application: HttpApplication;
      try {
        application = await boot();
      } catch (error) {
        report({ error, phase: "boot" });
        return new Response(
          JSON.stringify({ type: "about:blank", title: "Internal Server Error", status: 500, detail: "An unexpected error occurred" }),
          { status: 500, headers: { "content-type": "application/problem+json" } },
        );
      }
      return application.handle(request);
    },

    async close(signal) {
      const booted = app;
      app = undefined;
      if (booted) {
        const application = await booted.catch(() => undefined);
        await application?.close(signal);
      }
    },
  };
}
