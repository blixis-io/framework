import { Inject, Injectable } from "@blixis-io/di";
import { NotFoundException } from "@blixis-io/http";
import { tenantScope, type TenantContext } from "@blixis-io/tenancy";
import { and, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../db/index.js";
import { projects, tasks } from "../db/schema.js";
import { enqueue } from "../outbox/outbox.js";
import type { CreateProjectInput, CreateTaskInput } from "./project.schema.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id that is not a uuid cannot name a row; it is a 404, and never reaches the database to become an error. */
function asId(id: string): string {
  if (!UUID.test(id)) {
    throw new NotFoundException();
  }
  return id;
}

/**
 * Every method takes the tenant as an argument and puts `tenantScope()` in every query, whether it reads, updates,
 * deletes or joins: the pattern in the tenancy docs. A method that takes a tenant is also one a background job can call
 * (it builds its own `TenantContext`), which a method that reads the tenant from the request cannot be.
 */
@Injectable()
export class ProjectsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  list(tenant: TenantContext) {
    return this.db.select().from(projects).where(tenantScope(projects.spaceId, tenant)).orderBy(projects.createdAt);
  }

  async get(tenant: TenantContext, id: string) {
    const [project] = await this.db.select().from(projects).where(and(eq(projects.id, asId(id)), tenantScope(projects.spaceId, tenant)));
    if (!project) {
      throw new NotFoundException();
    }
    return project;
  }

  async create(tenant: TenantContext, input: CreateProjectInput) {
    // The project and the event that says it exists are one transaction (the outbox): both happen or neither does.
    // The tenant columns come from the guard's tenant, never from the request body.
    return this.db.transaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({ id: crypto.randomUUID(), title: input.title, organizationId: tenant.organizationId, spaceId: tenant.spaceId })
        .returning();
      if (project) {
        await enqueue(tx, "project.created", { projectId: project.id, title: project.title, organizationId: tenant.organizationId, spaceId: tenant.spaceId });
      }
      return project;
    });
  }

  async update(tenant: TenantContext, id: string, input: CreateProjectInput) {
    const [project] = await this.db
      .update(projects)
      .set({ title: input.title })
      .where(and(eq(projects.id, asId(id)), tenantScope(projects.spaceId, tenant)))
      .returning();
    if (!project) {
      throw new NotFoundException();
    }
    return project;
  }

  async remove(tenant: TenantContext, id: string): Promise<void> {
    const removed = await this.db
      .delete(projects)
      .where(and(eq(projects.id, asId(id)), tenantScope(projects.spaceId, tenant)))
      .returning({ id: projects.id });
    if (removed.length === 0) {
      throw new NotFoundException();
    }
  }

  async listTasks(tenant: TenantContext, projectId: string) {
    await this.get(tenant, projectId); // 404 for a project of another space, before any task is read
    return this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, asId(projectId)), tenantScope(tasks.spaceId, tenant)))
      .orderBy(tasks.createdAt);
  }

  async addTask(tenant: TenantContext, projectId: string, input: CreateTaskInput) {
    const project = await this.get(tenant, projectId);
    const [task] = await this.db
      .insert(tasks)
      .values({ id: crypto.randomUUID(), projectId: project.id, title: input.title, organizationId: tenant.organizationId, spaceId: tenant.spaceId })
      .returning();
    return task;
  }
}
