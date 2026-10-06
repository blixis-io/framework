import { ApiOperation, ApiTags, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, RequestContext, Returns, UseGuards } from "@blixis-io/http";
import { requireTenant, TenantScopedGuard } from "../tenancy/tenancy.js";
import {
  CreateProjectSchema,
  CreateTaskSchema,
  ProjectListSchema,
  ProjectSchema,
  TaskListSchema,
  TaskSchema,
  UpdateProjectSchema,
  type CreateProjectInput,
  type CreateTaskInput,
} from "./project.schema.js";
import { ProjectsService } from "./projects.service.js";

/**
 * Authentication comes from `protectAllRoutes`. `TenantScopedGuard` then checks the caller belongs to the space in the
 * URL, answering 404 (never 403) to a non-member, and puts the tenant where `requireTenant` finds it.
 */
@ApiTags("projects")
@UseGuards(TenantScopedGuard)
@Controller("spaces/:spaceId/projects")
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly ctx: RequestContext,
  ) {}

  @Get()
  @Returns(ProjectListSchema)
  @ApiOperation({ summary: "List the projects of a space" })
  list() {
    return this.projects.list(requireTenant(this.ctx));
  }

  @Post()
  @HttpCode(201)
  @Returns(ProjectSchema)
  @ApiOperation({ summary: "Create a project in a space" })
  create(@Body(CreateProjectSchema) body: CreateProjectInput) {
    return this.projects.create(requireTenant(this.ctx), body);
  }

  @Get(":id")
  @Returns(ProjectSchema)
  @ApiOperation({ summary: "Get one project" })
  get(@Param("id") id: string) {
    return this.projects.get(requireTenant(this.ctx), id);
  }

  @Patch(":id")
  @Returns(ProjectSchema)
  @ApiOperation({ summary: "Rename a project" })
  update(@Param("id") id: string, @Body(UpdateProjectSchema) body: CreateProjectInput) {
    return this.projects.update(requireTenant(this.ctx), id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a project and its tasks" })
  remove(@Param("id") id: string) {
    return this.projects.remove(requireTenant(this.ctx), id);
  }

  @Get(":id/tasks")
  @Returns(TaskListSchema)
  @ApiOperation({ summary: "List the tasks of a project" })
  listTasks(@Param("id") id: string) {
    return this.projects.listTasks(requireTenant(this.ctx), id);
  }

  @Post(":id/tasks")
  @HttpCode(201)
  @Returns(TaskSchema)
  @ApiOperation({ summary: "Add a task to a project" })
  addTask(@Param("id") id: string, @Body(CreateTaskSchema) body: CreateTaskInput) {
    return this.projects.addTask(requireTenant(this.ctx), id, body);
  }
}
