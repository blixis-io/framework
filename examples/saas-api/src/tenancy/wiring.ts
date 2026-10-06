import type { OnApplicationShutdown, OnModuleInit } from "@blixis-io/core";
import { Inject, Injectable } from "@blixis-io/di";
import { DATABASE, type Database } from "../db/index.js";
import { directory } from "./tenancy.js";

/** Hands the booted application's database to the membership lookup, and takes it back on shutdown. */
@Injectable()
export class MembershipDirectoryWiring implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  onModuleInit(): void {
    directory.db = this.db;
  }

  onApplicationShutdown(): void {
    if (directory.db === this.db) {
      directory.db = undefined;
    }
  }
}
