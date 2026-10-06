import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Verifies the Postgres row-level-security recipe in the tenancy docs against a real database, so it is a tested
 * recipe and not a hope. RLS is defence in depth: the application still scopes its queries (see isolation.test.ts).
 */

const CONNECTION = "postgres://blixis:blixis@localhost:5434/blixis";
const SPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROLE = "iso_rls_app";

// One connection only, so "the next request gets the same connection" is the certain case, not a coincidence.
const pool = new Pool({ connectionString: CONNECTION, max: 1 });

/** What a request does: its own transaction, the unprivileged role, the tenant set for this transaction only. */
async function asTenant<T>(spaceId: string | undefined, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${ROLE}`);
    if (spaceId !== undefined) {
      await client.query("select set_config('app.space_id', $1, true)", [spaceId]);
    }
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

const titles = async (client: PoolClient) => (await client.query<{ title: string }>("select title from iso_rls_projects order by title")).rows.map((row) => row.title);

beforeAll(async () => {
  await pool.query("drop table if exists iso_rls_projects");
  await pool.query(`drop owned by ${ROLE}`).catch(() => {});
  await pool.query(`drop role if exists ${ROLE}`);
  await pool.query("create table iso_rls_projects (id uuid primary key default gen_random_uuid(), title text not null, space_id uuid not null)");
  await pool.query("alter table iso_rls_projects enable row level security");
  // FORCE makes the table's owner subject to the policy too; a superuser or a role with BYPASSRLS still is not.
  await pool.query("alter table iso_rls_projects force row level security");
  await pool.query(`create policy tenant_isolation on iso_rls_projects
    using (space_id = nullif(current_setting('app.space_id', true), '')::uuid)
    with check (space_id = nullif(current_setting('app.space_id', true), '')::uuid)`);
  await pool.query(`create role ${ROLE} nologin`);
  await pool.query(`grant select, insert, update, delete on iso_rls_projects to ${ROLE}`);
  await pool.query("insert into iso_rls_projects (title, space_id) values ('a-project', $1), ('b-project', $2)", [SPACE_A, SPACE_B]);
});

afterAll(async () => {
  await pool.query("drop table if exists iso_rls_projects");
  await pool.query(`drop owned by ${ROLE}`).catch(() => {});
  await pool.query(`drop role if exists ${ROLE}`);
  await pool.end();
});

describe("row-level security as defence in depth", () => {
  it("shows each tenant only its own rows, even for a query with no WHERE clause", async () => {
    expect(await asTenant(SPACE_A, titles)).toEqual(["a-project"]);
    expect(await asTenant(SPACE_B, titles)).toEqual(["b-project"]);
  });

  it("shows nothing when no tenant was set, rather than everything", async () => {
    expect(await asTenant(undefined, titles)).toEqual([]);
  });

  it("refuses to insert a row for another tenant", async () => {
    await expect(asTenant(SPACE_A, (client) => client.query("insert into iso_rls_projects (title, space_id) values ('smuggled', $1)", [SPACE_B]))).rejects.toMatchObject({
      code: "42501", // insufficient_privilege: the row violates the policy
    });
  });

  it("changes and deletes nothing of another tenant's, without an error", async () => {
    const updated = await asTenant(SPACE_A, (client) => client.query("update iso_rls_projects set title = 'hijacked' where space_id = $1", [SPACE_B]));
    const deleted = await asTenant(SPACE_A, (client) => client.query("delete from iso_rls_projects where space_id = $1", [SPACE_B]));

    expect([updated.rowCount, deleted.rowCount]).toEqual([0, 0]);
    expect(await asTenant(SPACE_B, titles)).toEqual(["b-project"]);
  });

  it("forgets the tenant when the transaction ends, so the next request on the same pooled connection starts with none", async () => {
    await asTenant(SPACE_A, titles);

    expect(await asTenant(undefined, titles)).toEqual([]);
  });

  it("leaks the tenant to the next request when it is set for the session instead of the transaction (the pitfall)", async () => {
    const client = await pool.connect();
    await client.query(`set role ${ROLE}`);
    await client.query("select set_config('app.space_id', $1, false)", [SPACE_A]); // false = session-wide: wrong
    client.release();

    const next = await pool.connect();
    const leaked = await titles(next);
    await next.query("reset role");
    await next.query("select set_config('app.space_id', '', false)");
    next.release();

    expect(leaked).toEqual(["a-project"]);
  });

  it("does not protect against a connection that is a superuser or has BYPASSRLS, so the application must not use one", async () => {
    const rows = await pool.query("select title from iso_rls_projects order by title");

    expect(rows.rows.map((row: { title: string }) => row.title)).toEqual(["a-project", "b-project"]);
  });
});
