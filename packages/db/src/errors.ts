/** Thrown from `DbConnection.onModuleInit()` when the initial connectivity check (`SELECT 1`) fails — surfaces at boot, not on the first query a request happens to make. */
export class DbConnectionError extends Error {
  constructor(cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to connect to database: ${reason}`, { cause });
    this.name = "DbConnectionError";
  }
}

/** `@Transactional` was used on a class it can't find a database on, or that holds several. */
export class TransactionalError extends Error {
  override readonly name = "TransactionalError";
}
