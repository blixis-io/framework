import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MissingTenantError } from "./errors.js";
import type { TenantContext } from "./module.js";
import { tenantColumns, tenantScope } from "./scope.js";

const TEST_CONNECTION = "postgres://blixis:blixis@localhost:5434/blixis";

const posts = pgTable("tenancy_scope_test_posts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  ...tenantColumns(),
});

const pool = new Pool({ connectionString: TEST_CONNECTION });
const db = drizzle(pool, { schema: { posts } });

const TENANT_A: TenantContext = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  environmentId: "main",
  role: "editor",
};
const TENANT_B: TenantContext = {
  organizationId: "22222222-2222-4222-8222-222222222222",
  spaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  environmentId: "main",
  role: "editor",
};

beforeAll(async () => {
  await db.execute(`
    create table if not exists tenancy_scope_test_posts (
      id text primary key,
      title text not null,
      organization_id uuid not null,
      space_id uuid not null
    )
  `);
  await db.execute(`delete from tenancy_scope_test_posts`);
  await db.insert(posts).values([
    { id: "1", title: "from tenant a", organizationId: TENANT_A.organizationId, spaceId: TENANT_A.spaceId },
    { id: "2", title: "from tenant b", organizationId: TENANT_B.organizationId, spaceId: TENANT_B.spaceId },
  ]);
});

afterAll(async () => {
  await db.execute(`drop table if exists tenancy_scope_test_posts`);
  await pool.end();
});

describe("tenantScope", () => {
  it("filters a real query to only the given tenant's rows", async () => {
    const rows = await db.select().from(posts).where(tenantScope(posts.spaceId, TENANT_A));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("from tenant a");
  });

  it("returns the other tenant's rows for a different tenant, never both", async () => {
    const rows = await db.select().from(posts).where(tenantScope(posts.spaceId, TENANT_B));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("from tenant b");
  });

  it("throws MissingTenantError instead of silently returning an unscoped query", () => {
    expect(() => tenantScope(posts.spaceId, undefined)).toThrow(MissingTenantError);
  });
});

describe("tenantColumns", () => {
  it("produces organizationId/spaceId columns usable in a real insert and query", async () => {
    const [row] = await db.select().from(posts).where(tenantScope(posts.spaceId, TENANT_A));

    expect(row?.organizationId).toBe(TENANT_A.organizationId);
    expect(row?.spaceId).toBe(TENANT_A.spaceId);
  });
});
