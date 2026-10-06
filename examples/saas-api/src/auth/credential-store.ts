import type { CredentialStore } from "@blixis-io/auth";
import { Inject, Injectable } from "@blixis-io/di";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../db/index.js";
import { users } from "../db/schema.js";
import type { Claims } from "./auth.js";

@Injectable()
export class DrizzleCredentialStore implements CredentialStore<Claims> {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findByIdentifier(identifier: string) {
    const [user] = await this.db.select().from(users).where(eq(users.email, identifier.toLowerCase()));
    return user ? { subject: user.id, passwordHash: user.passwordHash } : null;
  }

  async loadClaims(subject: string): Promise<Claims | null> {
    const [user] = await this.db.select().from(users).where(eq(users.id, subject));
    return user ? { sub: user.id, email: user.email } : null;
  }
}
