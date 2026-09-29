import { z } from "zod";

export const CreatePostSchema = z.object({
  title: z.string().min(1),
  body: z.string().default(""),
});
export type CreatePostInput = z.infer<typeof CreatePostSchema>;

export const UpdatePostSchema = CreatePostSchema.partial();
export type UpdatePostInput = z.infer<typeof UpdatePostSchema>;

export const PostSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type Post = z.infer<typeof PostSchema>;

export const PostListSchema = z.array(PostSchema);
