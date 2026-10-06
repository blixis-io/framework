import { z } from "zod";

export const ProjectSchema = z.object({ id: z.string(), title: z.string(), spaceId: z.string() });
export const ProjectListSchema = z.array(ProjectSchema);
export const TaskSchema = z.object({ id: z.string(), projectId: z.string(), title: z.string(), done: z.boolean() });
export const TaskListSchema = z.array(TaskSchema);

/**
 * The only thing a client may set on a project. Anything else in the body (`spaceId`, `organizationId`) is stripped by the
 * schema, and the row's tenant always comes from the guard, never from here.
 */
export const CreateProjectSchema = z.object({ title: z.string().min(1).max(200) });
export const UpdateProjectSchema = CreateProjectSchema;
export const CreateTaskSchema = z.object({ title: z.string().min(1).max(200) });

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
