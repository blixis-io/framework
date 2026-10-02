import { Module, type DynamicModule, type OnApplicationShutdown, type OnModuleInit } from "@blixis-io/core";
import { Injectable, InjectionToken } from "@blixis-io/di";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { DbConnectionError } from "../errors.js";
import { transactionAware } from "./transactional.js";

export interface DrizzleModuleOptions {
  /** Passed straight to `pg.Pool` — either a connection string or a full `PoolConfig`. */
  connection: string | PoolConfig;
  /** Makes `DATABASE` visible to every module without each one importing this one directly, like `LoggerModule`/`ConfigModule`. Defaults to `false`. */
  global?: boolean;
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
        readonly pool = new Pool(
          typeof options.connection === "string" ? { connectionString: options.connection } : options.connection,
        );
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
