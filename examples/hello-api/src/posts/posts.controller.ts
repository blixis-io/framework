import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Returns, UseGuards, UseInterceptors } from "@blixis/http";
import { ApiKeyGuard } from "./api-key.guard.js";
import {
  CreatePostSchema,
  PostListSchema,
  PostSchema,
  UpdatePostSchema,
  type CreatePostInput,
  type UpdatePostInput,
} from "./post.schema.js";
import { PostsService } from "./posts.service.js";
import { TimingInterceptor } from "./timing.interceptor.js";

@UseInterceptors(TimingInterceptor)
@Controller("posts")
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  @Returns(PostListSchema)
  list() {
    return this.posts.list();
  }

  @Get(":id")
  @Returns(PostSchema)
  get(@Param("id") id: string) {
    return this.posts.get(id);
  }

  @Post()
  @HttpCode(201)
  @Returns(PostSchema)
  create(@Body(CreatePostSchema) input: CreatePostInput) {
    return this.posts.create(input);
  }

  @Patch(":id")
  @Returns(PostSchema)
  update(@Param("id") id: string, @Body(UpdatePostSchema) input: UpdatePostInput) {
    return this.posts.update(id, input);
  }

  @UseGuards(ApiKeyGuard)
  @Delete(":id")
  async remove(@Param("id") id: string): Promise<undefined> {
    await this.posts.remove(id);
    return undefined;
  }
}
