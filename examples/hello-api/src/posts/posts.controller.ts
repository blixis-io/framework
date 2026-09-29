import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards, UseInterceptors } from "@blixis/http";
import { ApiKeyGuard } from "./api-key.guard.js";
import { CreatePostSchema, UpdatePostSchema, type CreatePostInput, type UpdatePostInput } from "./post.schema.js";
import { PostsService } from "./posts.service.js";
import { TimingInterceptor } from "./timing.interceptor.js";

@UseInterceptors(TimingInterceptor)
@Controller("posts")
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  list() {
    return this.posts.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.posts.get(id);
  }

  @Post()
  @HttpCode(201)
  create(@Body(CreatePostSchema) input: CreatePostInput) {
    return this.posts.create(input);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body(UpdatePostSchema) input: UpdatePostInput) {
    return this.posts.update(id, input);
  }

  @UseGuards(ApiKeyGuard)
  @Delete(":id")
  remove(@Param("id") id: string): undefined {
    this.posts.remove(id);
    return undefined;
  }
}
