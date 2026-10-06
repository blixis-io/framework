import type { OnApplicationShutdown } from "@blixis-io/core";
import type { Health } from "@blixis-io/health";
import { Inject, Injectable } from "@blixis-io/di";
import { sql } from "drizzle-orm";
import { DATABASE, type Database } from "../db/index.js";
import { HEALTH } from "./health.js";

/** The provider that owns the database registers the check for it, so `/readyz` says what the app really depends on. */
@Injectable()
export class DatabaseHealth implements OnApplicationShutdown {
  readonly #remove: () => void;

  constructor(
    @Inject(HEALTH) health: Health,
    @Inject(DATABASE) db: Database,
  ) {
    this.#remove = health.check("database", async () => {
      await db.execute(sql`select 1`);
    });
  }

  /** The pool is about to close, so the check would only fail from here on. */
  onApplicationShutdown(): void {
    this.#remove();
  }
}
