import { Command } from "@blixis-io/commands";
import { Inject } from "@blixis-io/di";
import { DATABASE, type Database } from "./index.js";
import { migrate } from "./migrate.js";

/** `blix run db:migrate`: apply pending migrations. A deploy step, run once per release. */
@Command({ name: "db:migrate", description: "Apply pending database migrations" })
export class MigrateCommand {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async run(): Promise<number> {
    const applied = await migrate(this.db);
    console.log(applied.length === 0 ? "database is up to date" : `applied: ${applied.join(", ")}`);
    return 0;
  }
}
