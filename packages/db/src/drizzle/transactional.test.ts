import { createApplication, Module } from "@blixis-io/core";
import { Inject, Injectable } from "@blixis-io/di";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TransactionalError } from "../errors.js";
import { defineDrizzleModule } from "./module.js";
import { Transactional } from "./transactional.js";

const CONNECTION = "postgres://blixis:blixis@localhost:5434/blixis";
const TABLE = `tx_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const table = sql.identifier(TABLE);

const { DATABASE, DrizzleModule } = defineDrizzleModule({});
type Db = ReturnType<typeof makeDbType>;
declare function makeDbType(): import("drizzle-orm/node-postgres").NodePgDatabase<Record<string, never>>;

const gate = () => {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

@Injectable()
class Accounts {
  constructor(@Inject(DATABASE) readonly db: Db) {}

  async count(): Promise<number> {
    const result = await this.db.execute<{ n: string }>(sql`select count(*)::text as n from ${table}`);
    return Number(result.rows[0]?.n);
  }

  async add(name: string): Promise<void> {
    await this.db.execute(sql`insert into ${table} (name) values (${name})`);
  }

  @Transactional()
  async addTwo(a: string, b: string): Promise<void> {
    await this.add(a);
    await this.add(b);
  }

  @Transactional()
  async addThenFail(name: string): Promise<void> {
    await this.add(name);
    throw new Error("boom");
  }

  /** Same as addThenFail but not transactional: the write is committed before the throw. */
  async addThenFailPlain(name: string): Promise<void> {
    await this.add(name);
    throw new Error("boom");
  }

  @Transactional()
  async seeOwnWrites(name: string): Promise<number> {
    await this.add(name);
    return this.count();
  }

  @Transactional()
  async slowWrite(name: string, inside: Promise<void>, release: () => void): Promise<void> {
    await this.add(name);
    release();
    await inside;
  }

  @Transactional()
  async parallelWrites(): Promise<number> {
    await Promise.all([this.add("p1"), this.add("p2"), this.add("p3")]);
    return this.count();
  }

  @Transactional({ isolationLevel: "serializable" })
  async isolation(): Promise<string> {
    const result = await this.db.execute<{ transaction_isolation: string }>(sql`show transaction_isolation`);
    return result.rows[0]?.transaction_isolation ?? "";
  }
}

@Injectable()
class Transfers {
  constructor(
    @Inject(DATABASE) readonly db: Db,
    private readonly accounts: Accounts,
  ) {}

  @Transactional()
  async both(): Promise<void> {
    await this.accounts.addTwo("t1", "t2");
    await this.accounts.add("t3");
  }

  @Transactional()
  async innerFails(): Promise<void> {
    await this.accounts.add("outer-ok");
    await this.accounts.addThenFail("inner");
  }
}

@Module({ imports: [DrizzleModule.forRoot({ connection: CONNECTION })], providers: [Accounts, Transfers] })
class AppModule {}

let app: Awaited<ReturnType<typeof createApplication>>;
let accounts: Accounts;
let transfers: Transfers;

beforeAll(async () => {
  app = await createApplication(AppModule);
  accounts = app.get(Accounts);
  transfers = app.get(Transfers);
  await accounts.db.execute(sql`create table ${table} (id serial primary key, name text not null)`);
});

afterAll(async () => {
  await accounts.db.execute(sql`drop table if exists ${table}`);
  await app.close();
});

const reset = () => accounts.db.execute(sql`truncate ${table}`);

describe("@Transactional", () => {
  it("commits when the method resolves", async () => {
    await reset();

    await accounts.addTwo("a", "b");

    expect(await accounts.count()).toBe(2);
  });

  it("rolls back everything when the method throws, and rethrows the error", async () => {
    await reset();

    await expect(accounts.addThenFail("x")).rejects.toThrow("boom");

    expect(await accounts.count()).toBe(0);
  });

  it("without @Transactional a failure leaves the earlier write committed (nothing to roll back)", async () => {
    await reset();

    await expect(accounts.addThenFailPlain("kept")).rejects.toThrow("boom");

    expect(await accounts.count()).toBe(1);
  });

  it("reads inside the transaction see its own uncommitted writes", async () => {
    await reset();

    expect(await accounts.seeOwnWrites("mine")).toBe(1);
  });

  it("keeps uncommitted writes invisible to code outside the transaction", async () => {
    await reset();
    const written = gate();
    const checked = gate();

    const running = accounts.slowWrite("pending", checked.promise, written.open);
    await written.promise;
    const outside = await accounts.count(); // runs outside the transaction: a different connection
    checked.open();
    await running;

    expect(outside).toBe(0);
    expect(await accounts.count()).toBe(1);
  });

  it("nested @Transactional calls across services join one transaction and commit together", async () => {
    await reset();

    await transfers.both();

    expect(await accounts.count()).toBe(3);
  });

  it("a failure in a nested call rolls back the whole outer transaction", async () => {
    await reset();

    await expect(transfers.innerFails()).rejects.toThrow("boom");

    expect(await accounts.count()).toBe(0);
  });

  it("work started with Promise.all inside the method shares the transaction", async () => {
    await reset();

    expect(await accounts.parallelWrites()).toBe(3);
    expect(await accounts.count()).toBe(3);
  });

  it("passes transaction options such as the isolation level through", async () => {
    expect(await accounts.isolation()).toBe("serializable");
  });

  it("does not leak into later calls: after the method returns, queries autocommit again", async () => {
    await reset();
    await accounts.addTwo("a", "b");

    await accounts.add("after");
    await expect(accounts.addThenFail("rolled back")).rejects.toThrow("boom");

    expect(await accounts.count()).toBe(3);
  });

  it("explicit db.transaction() still works through the wrapper", async () => {
    await reset();

    await accounts.db.transaction(async (tx) => {
      await tx.execute(sql`insert into ${table} (name) values ('manual')`);
    });

    expect(await accounts.count()).toBe(1);
  });

  it("two applications each keep their own transaction", async () => {
    await reset();
    const other = await createApplication(AppModule);
    const otherAccounts = other.get(Accounts);
    const written = gate();
    const checked = gate();

    const running = accounts.slowWrite("app-one", checked.promise, written.open);
    await written.promise;
    // Another app, another connection wrapper: it is not inside app one's transaction.
    const seenByOther = await otherAccounts.count();
    checked.open();
    await running;
    await other.close();

    expect(seenByOther).toBe(0);
  });
});

describe("@Transactional errors", () => {
  it("fails clearly when the class has no database", async () => {
    @Injectable()
    class NoDb {
      @Transactional()
      async run(): Promise<void> {}
    }

    await expect(new NoDb().run()).rejects.toThrow(TransactionalError);
    await expect(new NoDb().run()).rejects.toThrow("NoDb.run is @Transactional but no DATABASE is a property of this class");
  });

  it("refuses to guess when the class holds two databases", async () => {
    const second = defineDrizzleModule({});
    @Injectable()
    class Both {
      constructor(
        @Inject(DATABASE) readonly one: Db,
        @Inject(second.DATABASE) readonly two: Db,
      ) {}

      @Transactional()
      async run(): Promise<void> {}

      @Transactional({ database: (self: Both) => self.two })
      async runOnSecond(): Promise<string> {
        const result = await this.two.execute<{ ok: number }>(sql`select 1 as ok`);
        return String(result.rows[0]?.ok);
      }
    }

    @Module({
      imports: [DrizzleModule.forRoot({ connection: CONNECTION }), second.DrizzleModule.forRoot({ connection: CONNECTION })],
      providers: [Both],
    })
    class Root {}
    const both = await createApplication(Root);
    const instance = both.get(Both);

    await expect(instance.run()).rejects.toThrow("holds 2 databases");
    await expect(instance.runOnSecond()).resolves.toBe("1");
    await both.close();
  });

  it("the `database` option must return a real DATABASE", async () => {
    @Injectable()
    class Wrong {
      @Transactional({ database: () => ({}) })
      async run(): Promise<void> {}
    }

    await expect(new Wrong().run()).rejects.toThrow('the "database" option did not return a DATABASE');
  });

  it("finds the database behind a repository with the `database` option", async () => {
    @Injectable()
    class Repo {
      constructor(@Inject(DATABASE) readonly db: Db) {}
    }

    @Injectable()
    class Service {
      constructor(readonly repo: Repo) {}

      @Transactional({ database: (self: Service) => self.repo.db })
      async run(): Promise<string> {
        const result = await this.repo.db.execute<{ ok: number }>(sql`select 1 as ok`);
        return String(result.rows[0]?.ok);
      }
    }

    @Module({ imports: [DrizzleModule.forRoot({ connection: CONNECTION })], providers: [Repo, Service] })
    class Root {}
    const nested = await createApplication(Root);

    await expect(nested.get(Service).run()).resolves.toBe("1");
    await nested.close();
  });

  it("rejects decorating something that isn't a method", () => {
    expect(() => Transactional()(class {}.prototype, "field", {})).toThrow("@Transactional can only decorate a method.");
  });

  it("is checked by the compiler: the method must return a promise", () => {
    class Typed {
      // @ts-expect-error a synchronous method can't run inside an async transaction
      @Transactional()
      sync(): number {
        return 1;
      }

      @Transactional()
      async fine(): Promise<number> {
        return 1;
      }
    }

    expect(Typed).toBeDefined();
  });
});
