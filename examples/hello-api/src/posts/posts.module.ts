import { Module } from "@blixis/core";
import { DrizzleModule } from "../db/index.js";
import { ApiKeyGuard } from "./api-key.guard.js";
import { PostsController } from "./posts.controller.js";
import { PostsService } from "./posts.service.js";
import { TimingInterceptor } from "./timing.interceptor.js";

@Module({
  imports: [
    DrizzleModule.forRoot({
      connection: process.env.DATABASE_URL ?? "postgres://blixis:blixis@localhost:5434/blixis",
    }),
  ],
  providers: [PostsService, ApiKeyGuard, TimingInterceptor],
  controllers: [PostsController],
})
export class PostsModule {}
