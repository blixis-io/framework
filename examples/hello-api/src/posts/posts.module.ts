import { Module } from "@blixis/core";
import { ApiKeyGuard } from "./api-key.guard.js";
import { PostsController } from "./posts.controller.js";
import { PostsService } from "./posts.service.js";
import { TimingInterceptor } from "./timing.interceptor.js";

@Module({
  providers: [PostsService, ApiKeyGuard, TimingInterceptor],
  controllers: [PostsController],
})
export class PostsModule {}
