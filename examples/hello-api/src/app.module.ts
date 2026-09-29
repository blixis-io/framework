import { Module } from "@blixis/core";
import { consoleTransport, LoggerModule } from "@blixis/logging";
import { PostsModule } from "./posts/posts.module.js";

@Module({
  imports: [LoggerModule.forRoot({ transports: [consoleTransport()] }), PostsModule],
})
export class AppModule {}
