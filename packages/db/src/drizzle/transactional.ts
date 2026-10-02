import { AsyncLocalStorage } from "node:async_hooks";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import { TransactionalError } from "../errors.js";

/** The one thing a database needs for transactions: Drizzle's own `transaction()`. */
interface HasTransaction {
  transaction<T>(callback: (tx: object) => Promise<T>, config?: PgTransactionConfig): Promise<T>;
}

interface TransactionRunner {
  run<T>(fn: () => Promise<T>, config?: PgTransactionConfig): Promise<T>;
}

/** `Symbol.for`, so a decorator from one copy of this package still recognises a database made by another. */
const RUNNER = Symbol.for("blixis:transaction-runner");

/**
 * Wraps a Drizzle database so every query goes to the *current transaction* when there is one, and to the
 * pool otherwise. "Current" is tracked per call chain (`AsyncLocalStorage`), so code written as
 * `this.db.insert(...)` joins a surrounding transaction without being changed or passed a `tx`.
 * One wrapper per connection: two applications, or two databases, never see each other's transaction.
 */
export function transactionAware<Db extends HasTransaction>(base: Db): Db {
  const storage = new AsyncLocalStorage<object>();

  const runner: TransactionRunner = {
    run(fn, config) {
      // Already inside one: join it. A failure anywhere rolls the whole thing back.
      if (storage.getStore() !== undefined) {
        return fn();
      }
      return base.transaction((tx) => storage.run(tx, fn), config);
    },
  };

  return new Proxy(base, {
    get(target, property) {
      if (property === RUNNER) {
        return runner;
      }
      const active: object = storage.getStore() ?? target;
      const value: unknown = Reflect.get(active, property, active);
      return typeof value === "function" ? value.bind(active) : value;
    },
  });
}

function isRunner(value: unknown): value is TransactionRunner {
  return typeof value === "object" && value !== null && "run" in value && typeof value.run === "function";
}

function runnerOf(value: unknown): TransactionRunner | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const runner: unknown = Reflect.get(value, RUNNER);
  return isRunner(runner) ? runner : undefined;
}

export interface TransactionalOptions extends PgTransactionConfig {
  /**
   * Where the database is, when it isn't a direct property of the class (for example behind a repository:
   * `database: (self) => self.repo.db`). By default the decorator uses the one injected database it finds
   * on the instance.
   */
  database?: (instance: never) => unknown;
}

function findRunner(instance: object, options: TransactionalOptions, name: string): TransactionRunner {
  if (options.database) {
    const chosen = runnerOf(Reflect.apply(options.database, undefined, [instance]));
    if (!chosen) {
      throw new TransactionalError(`${name}: the "database" option did not return a DATABASE from @blixis-io/db.`);
    }
    return chosen;
  }

  const found = new Set<TransactionRunner>();
  for (const value of Object.values(instance)) {
    const runner = runnerOf(value);
    if (runner) {
      found.add(runner);
    }
  }
  const [only, ...others] = found;
  if (!only) {
    throw new TransactionalError(
      `${name} is @Transactional but no DATABASE is a property of this class. Inject it (constructor(@Inject(DATABASE) private db: ...)) or pass { database: (self) => ... }.`,
    );
  }
  if (others.length > 0) {
    throw new TransactionalError(`${name} is @Transactional and this class holds ${found.size} databases. Say which with { database: (self) => self.db }.`);
  }
  return only;
}

/**
 * Runs the method inside a database transaction: it commits when the method resolves and rolls back when it
 * throws. Calls to other `@Transactional` methods, in this class or any other sharing the same database, join
 * the outer transaction instead of starting another.
 *
 * The method must be `async`: the compiler rejects one that doesn't return a promise. Queries must go through
 * the injected `DATABASE` (`this.db...`); that is what is redirected to the transaction.
 *
 * Don't emit events from inside a transactional method if listeners must only see committed data: handlers run
 * in the same call chain, so they join the transaction and have already run if it later rolls back. Emit after
 * the method returns.
 */
export function Transactional(options: TransactionalOptions = {}) {
  const { database: _database, ...config } = options;
  const hasConfig = Object.keys(config).length > 0;

  return <T extends (...args: never[]) => Promise<unknown>>(
    target: object,
    method: string | symbol,
    descriptor: TypedPropertyDescriptor<T>,
  ): void => {
    const original = descriptor.value;
    if (typeof original !== "function") {
      throw new TypeError("@Transactional can only decorate a method.");
    }
    const name = `${target.constructor.name}.${String(method)}`;

    Object.defineProperty(descriptor, "value", {
      // `async`, so a missing database is a rejected promise like any other failure, never a synchronous throw.
      value: async function (this: object, ...args: never[]): Promise<unknown> {
        const runner = findRunner(this, options, name);
        return runner.run(() => Reflect.apply(original, this, args), hasConfig ? config : undefined);
      },
    });
  };
}
