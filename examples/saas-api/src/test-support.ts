import type { HttpApplication } from "@blixis-io/http";
import type { LogRecord, Logger, Transport } from "@blixis-io/logging";
import { createLogger } from "@blixis-io/logging";
import { createApp } from "./app.js";
import { DATABASE } from "./db/index.js";
import { migrate } from "./db/migrate.js";

export const TEST_ORIGIN = "https://app.example.com";

/** Generous limits, so that the tests which are not about rate limiting never meet one. */
export const BASE_ENV: Record<string, string> = {
  DATABASE_URL: process.env["DATABASE_URL"] ?? "postgres://blixis:blixis@localhost:5434/blixis",
  JWT_SECRET: "a-test-secret-that-is-at-least-32-bytes-long",
  CORS_ORIGINS: TEST_ORIGIN,
  RATE_LIMIT_PER_MINUTE: "100000",
  AUTH_RATE_LIMIT_PER_MINUTE: "100000",
};

export interface TestApp {
  app: HttpApplication;
  logs: LogRecord[];
  logger: Logger;
  close(): Promise<void>;
}

/** Starts the real application against the real database, with its logs captured, after applying the migrations. */
export async function startApp(env: Record<string, string> = {}): Promise<TestApp> {
  const logs: LogRecord[] = [];
  const transport: Transport = {
    log(record) {
      logs.push(record);
    },
  };
  const logger = createLogger({ transports: [transport] });
  const app = await createApp({ env: { ...BASE_ENV, ...env }, logger });
  await migrate(app.get(DATABASE));
  return { app, logs, logger, close: () => app.close() };
}

export interface Reply {
  status: number;
  headers: Headers;
  text: string;
  json: unknown;
}

export interface CallOptions {
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** A request through the whole application, in process: middleware, guards, validation, the database. */
export async function call(app: HttpApplication, method: string, path: string, options: CallOptions = {}): Promise<Reply> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) {
    headers["authorization"] = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const response = await app.handle(new Request(`http://localhost${path}`, { method, headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) }));
  const text = await response.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  return { status: response.status, headers: response.headers, text, json };
}

/** A property of a parsed JSON body, for a test that knows what it expects, without a cast. */
export function field(json: unknown, ...path: Array<string | number>): unknown {
  let current: unknown = json;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) {
      return undefined;
    }
    current = Reflect.get(current, key);
  }
  return current;
}

export function stringField(json: unknown, ...path: Array<string | number>): string {
  const value = field(json, ...path);
  if (typeof value !== "string") {
    throw new Error(`expected a string at ${path.join(".")}, got ${JSON.stringify(value)}`);
  }
  return value;
}

export const uniqueEmail = (label = "user"): string => `${label}-${crypto.randomUUID()}@example.com`;

export const PASSWORD = "correct horse battery staple";

export interface Account {
  email: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
  spaceId: string;
}

/** Signs up a fresh account (its own organization and first space) and reads back where it may act. */
export async function signUp(app: HttpApplication, label = "user"): Promise<Account> {
  const email = uniqueEmail(label);
  const created = await call(app, "POST", "/auth/sign-up", { body: { email, password: PASSWORD, organizationName: `${label} inc` } });
  if (created.status !== 201) {
    throw new Error(`sign-up answered ${created.status}: ${created.text}`);
  }
  const accessToken = stringField(created.json, "accessToken");
  const me = await call(app, "GET", "/me", { token: accessToken });
  return {
    email,
    accessToken,
    refreshToken: stringField(created.json, "refreshToken"),
    userId: stringField(me.json, "id"),
    spaceId: stringField(me.json, "spaces", 0, "id"),
  };
}
