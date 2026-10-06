import { hashPassword } from "@blixis-io/auth";
import { Inject, Injectable } from "@blixis-io/di";
import { Transactional } from "@blixis-io/db";
import { ConflictException } from "@blixis-io/http";
import { DATABASE, type Database } from "../db/index.js";
import { memberships, organizations, spaces, users } from "../db/schema.js";

function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps the driver's error; Postgres reports a duplicate key as 23505.
  return typeof error === "object" && error !== null && "cause" in error && typeof error.cause === "object" && error.cause !== null && "code" in error.cause && error.cause.code === "23505";
}

@Injectable()
export class AccountsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Creates the user, their organization, a first space and the membership that ties them together, **all or nothing**:
   * `@Transactional()` makes the four inserts one transaction, so a failure part-way leaves no half-made account. Returns
   * the new user's id; the caller issues tokens *after* this returns, once the transaction has committed.
   */
  @Transactional()
  async signUp(email: string, password: string, organizationName: string): Promise<string> {
    const userId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const spaceId = crypto.randomUUID();
    try {
      await this.db.insert(users).values({ id: userId, email: email.toLowerCase(), passwordHash: await hashPassword(password) });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("An account with this email already exists");
      }
      throw error;
    }
    await this.db.insert(organizations).values({ id: organizationId, name: organizationName });
    await this.db.insert(spaces).values({ id: spaceId, organizationId, name: "Main" });
    await this.db.insert(memberships).values({ userId, spaceId, organizationId, role: "owner" });
    return userId;
  }
}
