import { Module, type DynamicModule, type OnApplicationShutdown, type OnModuleInit } from "@blixis-io/core";
import { Injectable, InjectionToken } from "@blixis-io/di";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { DbConnectionError } from "../errors.js";
import { transactionAware } from "./transactional.js";

/** How long a request for a connection may wait before it fails, unless `connectionTimeoutMillis` says otherwise. `pg` itself waits forever. */
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;

export interface DrizzleModuleOptions {
  /**
   * Passed to `pg.Pool` — either a connection string or a full `PoolConfig`. Unless you set
   * `connectionTimeoutMillis` (0 means no limit), a request for a connection fails after 10 seconds
   * instead of waiting forever when the pool is exhausted or the database is unreachable.
   */
  connection: string | PoolConfig;
  /** Makes `DATABASE` visible to every module without each one importing this one directly, like `LoggerModule`/`ConfigModule`. Defaults to `false`. */
  global?: boolean;
  /**
   * Called when the pool reports an error on an idle connection: the database restarted, the network dropped,
   * or an administrator ended the session. The pool discards that connection and opens a new one on demand, so
   * this is for logging and alerting, not recovery. Defaults to `console.error`. Without any listener `pg` would
   * rethrow the error and crash the process.
   */
  onPoolError?: (error: Error) => void;
}

function reportPoolError(error: Error): void {
  console.error("[@blixis-io/db] an idle database connection failed:", error);
}

/** A pool that waits for connections only so long, and whose idle-connection errors go to a handler instead of crashing the process. */
function createPool(options: DrizzleModuleOptions): Pool {
  const config: PoolConfig = typeof options.connection === "string" ? { connectionString: options.connection } : options.connection;
  const pool = new Pool({ ...config, connectionTimeoutMillis: config.connectionTimeoutMillis ?? DEFAULT_CONNECTION_TIMEOUT_MS });
  const handler = options.onPoolError ?? reportPoolError;
  pool.on("error", (error) => {
    try {
      handler(error);
    } catch (handlerError) {
      // A throwing handler must not become the crash this listener exists to prevent.
      console.error("[@blixis-io/db] the onPoolError handler threw:", handlerError);
      reportPoolError(error);
    }
  });
  return pool;
}

/**
 * Builds a `DATABASE` token + module bound to one Drizzle schema, same
 * factory-closure shape as `@blixis-io/config`'s `defineConfigModule` — schema
 * is fixed per app, connection options are supplied later via `forRoot()`.
 */
export function defineDrizzleModule<Schema extends Record<string, unknown>>(schema: Schema) {
  const DATABASE = new InjectionToken<NodePgDatabase<Schema>>("blixis.db");

  @Module()
  class DrizzleModule {
    /**
     * Opens the pool and registers `DATABASE` immediately; the pool itself
     * is a private, non-exported provider so its `OnModuleInit`/
     * `OnApplicationShutdown` hooks run automatically without any consumer
     * needing to inject it directly.
     */
    static forRoot(options: DrizzleModuleOptions): DynamicModule {
      @Injectable()
      class DbConnection implements OnModuleInit, OnApplicationShutdown {
        readonly pool = createPool(options);
        readonly db = transactionAware(drizzle(this.pool, { schema }));

        async onModuleInit(): Promise<void> {
          try {
            await this.pool.query("SELECT 1");
          } catch (cause) {
            throw new DbConnectionError(cause);
          }
        }

        async onApplicationShutdown(): Promise<void> {
          await this.pool.end();
        }
      }

      return {
        module: DrizzleModule,
        providers: [
          DbConnection,
          { provide: DATABASE, useFactory: (connection: DbConnection) => connection.db, inject: [DbConnection] },
        ],
        exports: [DATABASE],
        global: options.global ?? false,
      };
    }
  }

  return { DATABASE, DrizzleModule };
}
