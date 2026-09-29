import { Module } from "@blixis/core";
import { PostsModule } from "./posts/posts.module.js";

@Module({ imports: [PostsModule] })
export class AppModule {}
