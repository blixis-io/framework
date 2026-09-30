import {
  ApiOperation,
  ApiTags,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Returns,
  UseGuards,
  UseInterceptors,
} from "@blixis-io/http";
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

@ApiTags("posts")
@UseInterceptors(TimingInterceptor)
@Controller("posts")
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  @Returns(PostListSchema)
  @ApiOperation({ summary: "List every post" })
  list() {
    return this.posts.list();
  }

  @Get(":id")
  @Returns(PostSchema)
  @ApiOperation({ summary: "Get one post by id" })
  get(@Param("id") id: string) {
    return this.posts.get(id);
  }

  @Post()
  @HttpCode(201)
  @Returns(PostSchema)
  @ApiOperation({ summary: "Create a post" })
  create(@Body(CreatePostSchema) input: CreatePostInput) {
    return this.posts.create(input);
  }

  @Patch(":id")
  @Returns(PostSchema)
  @ApiOperation({ summary: "Update a post" })
  update(@Param("id") id: string, @Body(UpdatePostSchema) input: UpdatePostInput) {
    return this.posts.update(id, input);
  }

  @ApiTags("admin")
  @UseGuards(ApiKeyGuard)
  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a post", description: "Requires the x-api-key header." })
  async remove(@Param("id") id: string): Promise<undefined> {
    await this.posts.remove(id);
    return undefined;
  }
}
