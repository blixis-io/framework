import { Module } from "@blixis-io/core";
import { Inject, Injectable, InjectionToken } from "@blixis-io/di";
import {
  BadRequestException,
  Body,
  Controller,
  createHttpApplication,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  RequestContext,
  UnauthorizedException,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
  type HttpApplication,
} from "@blixis-io/http";
import { and, eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MissingTenantError } from "./errors.js";
import { assertSameTenant, defineTenancyModule, type TenantContext } from "./module.js";
import { tenantColumns, tenantScope } from "./scope.js";

/**
 * Hostile-input tests for the pattern the docs recommend, against a real Postgres: every query goes through
 * `tenantScope()`, tenant columns come from the guard and never from the body, and child tables carry a composite
 * foreign key. Each test is one way a caller might reach another tenant's data.
 */

const CONNECTION = "postgres://blixis:blixis@localhost:5434/blixis";

const memberships = pgTable("iso_memberships", {
  userId: text("user_id").notNull(),
  spaceId: uuid("space_id").notNull(),
  organizationId: uuid("organization_id").notNull(),
  role: text("role").notNull(),
});

const projects = pgTable("iso_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  ...tenantColumns(),
});

const tasks = pgTable("iso_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  title: text("title").notNull(),
  ...tenantColumns(),
});

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const SPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_A = "a0000000-0000-4000-8000-000000000001";
const PROJECT_B = "b0000000-0000-4000-8000-000000000001";
const TASK_A = "a1000000-0000-4000-8000-000000000001";
const TASK_B = "b1000000-0000-4000-8000-000000000001";
const NO_SUCH_SPACE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const pool = new Pool({ connectionString: CONNECTION });
const DB = new InjectionToken<NodePgDatabase>("iso-db");
const ACTOR_KEY = "iso.actor";

interface Actor {
  id: string;
}

const tenancy = defineTenancyModule<Actor>({
  getActor: (ctx) => ctx.get<Actor>(ACTOR_KEY),
  resolveMembership: async (actor, spaceId) => {
    // A malformed id is "no such space", not a database error: uuid casts would throw for it.
    if (!isUuid(spaceId)) {
      return null;
    }
    const db = drizzle(pool);
    const [row] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, actor.id), eq(memberships.spaceId, spaceId)));
    return row ? { organizationId: row.organizationId, role: row.role } : null;
  },
});

/** Stands in for the app's real authentication: the caller is whoever `x-user` names. */
@Injectable()
class HeaderAuthGuard implements CanActivate {
  constructor(private readonly ctx: RequestContext) {}

  canActivate({ request }: ExecutionContext): boolean {
    const user = request.headers.get("x-user");
    if (!user) {
      throw new UnauthorizedException();
    }
    this.ctx.set(ACTOR_KEY, { id: user });
    return true;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string): boolean => UUID.test(value);

/** The only thing a client may send for a project or task. Anything else in the body is ignored. */
function titleOf(body: unknown): string {
  const title = typeof body === "object" && body !== null && "title" in body ? body.title : undefined;
  if (typeof title !== "string" || title.length === 0) {
    throw new BadRequestException("title is required");
  }
  return title;
}

@Controller("spaces/:spaceId/projects")
@UseGuards(HeaderAuthGuard, tenancy.TenantScopedGuard)
class ProjectsController {
  constructor(
    @Inject(DB) private readonly db: NodePgDatabase,
    private readonly ctx: RequestContext,
  ) {}

  @Get()
  list() {
    return this.db.select().from(projects).where(tenantScope(projects.spaceId, tenancy.requireTenant(this.ctx)));
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const [row] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, uuidOr404(id)), tenantScope(projects.spaceId, tenancy.requireTenant(this.ctx))));
    if (!row) {
      throw new NotFoundException();
    }
    return row;
  }

  @Post()
  async create(@Body() body: unknown) {
    const tenant = tenancy.requireTenant(this.ctx);
    // The tenant columns come from the guard's tenant. The body is only ever the title.
    const [row] = await this.db
      .insert(projects)
      .values({ title: titleOf(body), organizationId: tenant.organizationId, spaceId: tenant.spaceId })
      .returning();
    return row;
  }

  @Patch(":id")
  async rename(@Param("id") id: string, @Body() body: unknown) {
    const [row] = await this.db
      .update(projects)
      .set({ title: titleOf(body) })
      .where(and(eq(projects.id, uuidOr404(id)), tenantScope(projects.spaceId, tenancy.requireTenant(this.ctx))))
      .returning();
    if (!row) {
      throw new NotFoundException();
    }
    return row;
  }

  @Delete(":id")
  async remove(@Param("id") id: string) {
    const deleted = await this.db
      .delete(projects)
      .where(and(eq(projects.id, uuidOr404(id)), tenantScope(projects.spaceId, tenancy.requireTenant(this.ctx))))
      .returning();
    if (deleted.length === 0) {
      throw new NotFoundException();
    }
    return { deleted: true };
  }

  @Get(":id/tasks")
  async listTasks(@Param("id") id: string) {
    const tenant = tenancy.requireTenant(this.ctx);
    return this.db
      .select({ id: tasks.id, title: tasks.title, project: projects.title })
      .from(tasks)
      .innerJoin(projects, and(eq(tasks.projectId, projects.id), eq(tasks.spaceId, projects.spaceId)))
      .where(and(eq(projects.id, uuidOr404(id)), tenantScope(tasks.spaceId, tenant), tenantScope(projects.spaceId, tenant)));
  }

  @Post(":id/tasks")
  async addTask(@Param("id") id: string, @Body() body: unknown) {
    const tenant = tenancy.requireTenant(this.ctx);
    const [project] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, uuidOr404(id)), tenantScope(projects.spaceId, tenant)));
    if (!project) {
      throw new NotFoundException();
    }
    const [row] = await this.db
      .insert(tasks)
      .values({ projectId: project.id, title: titleOf(body), organizationId: tenant.organizationId, spaceId: tenant.spaceId })
      .returning();
    return row;
  }
}

function uuidOr404(id: string): string {
  if (!isUuid(id)) {
    throw new NotFoundException();
  }
  return id;
}

/** The mistake the suite exists to catch: a lookup by id alone. Mounted so the suite can show it would notice. */
@Controller("spaces/:spaceId/unscoped")
@UseGuards(HeaderAuthGuard, tenancy.TenantScopedGuard)
class UnscopedController {
  constructor(@Inject(DB) private readonly db: NodePgDatabase) {}

  @Get(":id")
  async get(@Param("id") id: string) {
    const [row] = await this.db.select().from(projects).where(eq(projects.id, uuidOr404(id)));
    return row ?? null;
  }
}

/** A row loaded by id through code that is not tenant-scoped, then checked with `assertSameTenant`. */
@Controller("spaces/:spaceId/loaded")
@UseGuards(HeaderAuthGuard, tenancy.TenantScopedGuard)
class LoadedByIdController {
  constructor(
    @Inject(DB) private readonly db: NodePgDatabase,
    private readonly ctx: RequestContext,
  ) {}

  @Get(":id")
  async get(@Param("id") id: string) {
    const [row] = await this.db.select().from(projects).where(eq(projects.id, uuidOr404(id)));
    if (!row) {
      throw new NotFoundException();
    }
    assertSameTenant(row.spaceId, tenancy.requireTenant(this.ctx));
    return row;
  }
}

@Module({
  imports: [tenancy.TenancyModule.forRoot()],
  providers: [HeaderAuthGuard, { provide: DB, useFactory: () => drizzle(pool) }],
  controllers: [ProjectsController, UnscopedController, LoadedByIdController],
})
class IsolationModule {}

let app: HttpApplication;
const db = drizzle(pool);

async function call(user: string | undefined, method: string, path: string, body?: unknown) {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { ...(user ? { "x-user": user } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  const raw = await response.text();
  const json: unknown = raw ? JSON.parse(raw) : undefined;
  return { status: response.status, raw, json };
}

function idOf(json: unknown): string {
  if (typeof json === "object" && json !== null && "id" in json && typeof json.id === "string") {
    return json.id;
  }
  throw new Error("the response has no id");
}

const projectRows = () => db.select().from(projects).orderBy(projects.title);
const taskRows = () => db.select().from(tasks).orderBy(tasks.title);

beforeAll(async () => {
  await db.execute(sql`drop table if exists iso_tasks, iso_projects, iso_memberships`);
  await db.execute(sql`create table iso_memberships (user_id text not null, space_id uuid not null, organization_id uuid not null, role text not null, primary key (user_id, space_id))`);
  await db.execute(sql`create table iso_projects (id uuid primary key default gen_random_uuid(), title text not null, organization_id uuid not null, space_id uuid not null, unique (id, space_id))`);
  // The composite key is what stops a child pointing at another space's parent, even if application code forgot to check.
  await db.execute(sql`create table iso_tasks (id uuid primary key default gen_random_uuid(), project_id uuid not null, title text not null, organization_id uuid not null, space_id uuid not null, foreign key (project_id, space_id) references iso_projects (id, space_id))`);
  await db.insert(memberships).values([
    { userId: "alice", spaceId: SPACE_A, organizationId: ORG_A, role: "editor" },
    { userId: "bob", spaceId: SPACE_B, organizationId: ORG_B, role: "editor" },
    { userId: "dana", spaceId: SPACE_A, organizationId: ORG_A, role: "editor" },
    { userId: "dana", spaceId: SPACE_B, organizationId: ORG_B, role: "editor" },
  ]);
  await db.insert(projects).values([
    { id: PROJECT_A, title: "a-project", organizationId: ORG_A, spaceId: SPACE_A },
    { id: PROJECT_B, title: "b-project", organizationId: ORG_B, spaceId: SPACE_B },
  ]);
  await db.insert(tasks).values([
    { id: TASK_A, projectId: PROJECT_A, title: "a-task", organizationId: ORG_A, spaceId: SPACE_A },
    { id: TASK_B, projectId: PROJECT_B, title: "b-task", organizationId: ORG_B, spaceId: SPACE_B },
  ]);
  app = await createHttpApplication(IsolationModule);
});

afterAll(async () => {
  await app.close();
  await db.execute(sql`drop table if exists iso_tasks, iso_projects, iso_memberships`);
  await pool.end();
});

describe("tenant isolation: reading", () => {
  it("lists only the caller's own space", async () => {
    const { status, json } = await call("alice", "GET", `/spaces/${SPACE_A}/projects`);

    expect(status).toBe(200);
    expect(json).toEqual([expect.objectContaining({ id: PROJECT_A, spaceId: SPACE_A })]);
  });

  it("answers 404 for a space the caller is not a member of, with nothing from it", async () => {
    const { status, raw } = await call("alice", "GET", `/spaces/${SPACE_B}/projects`);

    expect(status).toBe(404);
    expect(raw).not.toContain("b-project");
  });

  it("makes a space that exists and a space that does not look the same to a non-member", async () => {
    const real = await call("alice", "GET", `/spaces/${SPACE_B}/projects`);
    const missing = await call("alice", "GET", `/spaces/${NO_SUCH_SPACE}/projects`);
    const malformed = await call("alice", "GET", `/spaces/not-a-uuid/projects`);

    expect([real.status, missing.status, malformed.status]).toEqual([404, 404, 404]);
    expect(real.raw).toBe(missing.raw);
    expect(real.raw).toBe(malformed.raw);
  });

  it("answers 401 without an identity, before any membership is checked", async () => {
    expect((await call(undefined, "GET", `/spaces/${SPACE_A}/projects`)).status).toBe(401);
  });

  it("does not hand another space's resource to a member of this space who names its id (id substitution)", async () => {
    const { status, raw } = await call("alice", "GET", `/spaces/${SPACE_A}/projects/${PROJECT_B}`);

    expect(status).toBe(404);
    expect(raw).not.toContain("b-project");
  });

  it("holds for a caller who belongs to both spaces: the route's space decides, not the id", async () => {
    const own = await call("dana", "GET", `/spaces/${SPACE_A}/projects/${PROJECT_A}`);
    const other = await call("dana", "GET", `/spaces/${SPACE_A}/projects/${PROJECT_B}`);
    const viaOtherSpace = await call("dana", "GET", `/spaces/${SPACE_B}/projects/${PROJECT_B}`);

    expect([own.status, other.status, viaOtherSpace.status]).toEqual([200, 404, 200]);
  });

  it("answers 404 for an id that is not a uuid instead of a database error", async () => {
    expect((await call("alice", "GET", `/spaces/${SPACE_A}/projects/1%27%20or%20%271%27=%271`)).status).toBe(404);
  });

  it("keeps simultaneous requests from different tenants apart", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        index % 2 === 0 ? call("alice", "GET", `/spaces/${SPACE_A}/projects`) : call("bob", "GET", `/spaces/${SPACE_B}/projects`),
      ),
    );

    results.forEach((result, index) => {
      expect(result.json).toEqual([expect.objectContaining({ spaceId: index % 2 === 0 ? SPACE_A : SPACE_B })]);
    });
  });
});

describe("tenant isolation: writing", () => {
  it("does not update another space's row, and leaves it unchanged", async () => {
    const before = await projectRows();

    const { status } = await call("alice", "PATCH", `/spaces/${SPACE_A}/projects/${PROJECT_B}`, { title: "hijacked" });

    expect(status).toBe(404);
    expect(await projectRows()).toEqual(before);
  });

  it("does not delete another space's row", async () => {
    const { status } = await call("alice", "DELETE", `/spaces/${SPACE_A}/projects/${PROJECT_B}`);

    expect(status).toBe(404);
    expect((await projectRows()).map((row) => row.id)).toContain(PROJECT_B);
  });

  it("takes the tenant columns of a new row from the guard, never from the body", async () => {
    const { status, json } = await call("alice", "POST", `/spaces/${SPACE_A}/projects`, {
      title: "forged",
      spaceId: SPACE_B,
      organizationId: ORG_B,
    });

    expect(status).toBe(200);
    expect(json).toMatchObject({ title: "forged", spaceId: SPACE_A, organizationId: ORG_A });
    const forged = (await projectRows()).filter((row) => row.title === "forged");
    expect(forged.map((row) => row.spaceId)).toEqual([SPACE_A]);
    await db.delete(projects).where(eq(projects.title, "forged"));
  });

  it("updates and deletes the caller's own rows, so the 404s above are about the tenant and not a broken route", async () => {
    const created = await call("alice", "POST", `/spaces/${SPACE_A}/projects`, { title: "temp" });
    const id = idOf(created.json);

    expect((await call("alice", "PATCH", `/spaces/${SPACE_A}/projects/${id}`, { title: "renamed" })).status).toBe(200);
    expect((await projectRows()).find((row) => row.id === id)?.title).toBe("renamed");
    expect((await call("alice", "DELETE", `/spaces/${SPACE_A}/projects/${id}`)).status).toBe(200);
    expect((await projectRows()).some((row) => row.id === id)).toBe(false);
  });
});

describe("tenant isolation: joins and child rows", () => {
  it("lists only the caller's tasks for the caller's project", async () => {
    const { json } = await call("alice", "GET", `/spaces/${SPACE_A}/projects/${PROJECT_A}/tasks`);

    expect(json).toEqual([{ id: TASK_A, title: "a-task", project: "a-project" }]);
  });

  it("returns nothing for another space's project, even through the join", async () => {
    const { json, raw } = await call("alice", "GET", `/spaces/${SPACE_A}/projects/${PROJECT_B}/tasks`);

    expect(json).toEqual([]);
    expect(raw).not.toContain("b-task");
  });

  it("refuses to add a task under another space's project", async () => {
    const before = await taskRows();

    const { status } = await call("alice", "POST", `/spaces/${SPACE_A}/projects/${PROJECT_B}/tasks`, { title: "smuggled" });

    expect(status).toBe(404);
    expect(await taskRows()).toEqual(before);
  });

  it("has the database refuse a task that points at another space's project even if the application forgot to check", async () => {
    await expect(
      db.insert(tasks).values({ projectId: PROJECT_B, title: "unchecked", organizationId: ORG_A, spaceId: SPACE_A }),
    ).rejects.toMatchObject({ cause: { code: "23503" } }); // foreign_key_violation
  });
});

const withoutTenant = (tenant: TenantContext | undefined) => db.select().from(projects).where(tenantScope(projects.spaceId, tenant));

describe("tenant isolation: code that has no request", () => {
  it("fails closed for a command or job that runs without a tenant", () => {
    expect(() => withoutTenant(undefined)).toThrow(MissingTenantError);
  });

  it("gets an explicit tenant in a job by building the context itself", async () => {
    const tenant: TenantContext = { organizationId: ORG_B, spaceId: SPACE_B, environmentId: "main", role: "system" };

    const rows = await db.select().from(projects).where(tenantScope(projects.spaceId, tenant));

    expect(rows.map((row) => row.id)).toEqual([PROJECT_B]);
  });
});

describe("tenant isolation: the checks that make up for a lookup by id", () => {
  it("assertSameTenant turns another space's row, loaded by id, into a 404", async () => {
    const own = await call("alice", "GET", `/spaces/${SPACE_A}/loaded/${PROJECT_A}`);
    const other = await call("alice", "GET", `/spaces/${SPACE_A}/loaded/${PROJECT_B}`);

    expect([own.status, other.status]).toEqual([200, 404]);
    expect(other.raw).not.toContain("b-project");
  });

  it("control: a lookup by id alone does leak, which is what the other tests would catch", async () => {
    const { status, json } = await call("alice", "GET", `/spaces/${SPACE_A}/unscoped/${PROJECT_B}`);

    expect(status).toBe(200);
    expect(json).toMatchObject({ id: PROJECT_B, title: "b-project" });
  });
});
