import { accessLog, createHttpApplication, requestId, type HttpApplication } from "@blixis-io/http";
import { consoleTransport, createLogger, type Logger } from "@blixis-io/logging";
import { serveOpenApi } from "@blixis-io/openapi";
import { cors, rateLimit, securityHeaders } from "@blixis-io/security";
import { createAppModule } from "./app.module.js";
import { AppConfigSchema } from "./config.js";
import { DATABASE, type Database } from "./db/index.js";
import { health } from "./platform/health.js";
import { DrizzleRateLimitStore } from "./platform/rate-limit-store.js";

export interface AppOptions {
  /** The environment to read configuration from. Default `process.env`. */
  env?: Record<string, string | undefined>;
  /** Where logs go. Default: JSON lines on the console. */
  logger?: Logger;
}

const AUTH_PATHS = new Set(["/auth/sign-up", "/auth/sign-in", "/auth/refresh"]);
const MINUTE = 60_000;

/**
 * Builds the whole application: the module graph, and the middleware that makes it safe to put on the internet. The order
 * of `middleware` is the point:
 *
 * 1. `health` answers `/livez` and `/readyz` before anything else, so a load balancer's probes are not logged or limited.
 * 2. `requestId` and `accessLog`: every response, including a 404 or a 429, gets an id and a log line.
 * 3. `cors` and `securityHeaders` next, so even a rejected request carries them: without CORS headers a browser hides the
 *    real status from the front end.
 * 4. The rate limits last: a strict one for the routes where passwords are guessed, a looser one for everything.
 */
export async function createApp(options: AppOptions = {}): Promise<HttpApplication> {
  const env = options.env ?? process.env;
  const config = AppConfigSchema.parse(env);
  const logger = options.logger ?? createLogger({ transports: [consoleTransport()] });

  // The middleware is built before the application, and the database only exists once it has booted.
  let database: Database | undefined;
  const store = new DrizzleRateLimitStore(() => {
    if (!database) {
      throw new Error("the rate limiter ran before the application finished booting");
    }
    return database;
  });
  const clientIp = { trustedProxyHops: config.TRUSTED_PROXY_HOPS };

  const app = await createHttpApplication(createAppModule(env, { onOutboxError: (error) => logger.error("outbox delivery failed", { error }) }), {
    middleware: [
      health.middleware,
      requestId(),
      accessLog({ log: (entry) => logger.info("request", { ...entry }) }),
      cors({ origins: config.CORS_ORIGINS, exposedHeaders: ["x-request-id", "ratelimit-remaining", "retry-after"] }),
      securityHeaders(),
      rateLimit({
        name: "auth",
        store,
        limit: config.AUTH_RATE_LIMIT_PER_MINUTE,
        windowMs: MINUTE,
        clientIp,
        match: (request) => request.method === "POST" && AUTH_PATHS.has(new URL(request.url).pathname),
        // If the limiter cannot count, sign-in must not become unlimited: refuse instead.
        onStoreError: "block",
      }),
      rateLimit({ name: "api", store, limit: config.RATE_LIMIT_PER_MINUTE, windowMs: MINUTE, clientIp }),
    ],
    // Every unexpected error, with the request id that ties it to the access log line and the response header.
    onError: ({ error, request, route, requestId: id, phase }) => {
      logger.error("unexpected error", {
        phase,
        requestId: id,
        method: request?.method,
        path: request ? new URL(request.url).pathname : undefined,
        handler: route ? `${route.controller.name}.${String(route.handler)}` : undefined,
        err: error,
      });
    },
    // Time a request may take before the client gets a 504: guards, queries and handler included.
    requestTimeout: 15_000,
  });

  database = app.get(DATABASE);
  health.watch(app);
  serveOpenApi(app, "/openapi.json", {
    title: "saas-api",
    version: "1.0.0",
    description: "A small multi-tenant API: accounts, spaces, projects and tasks. The framework's reference application.",
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      apiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
    },
    // Either one: a person's token, or an API key (routes say which scope a key needs).
    security: ["bearerAuth", "apiKeyAuth"],
  });
  return app;
}
