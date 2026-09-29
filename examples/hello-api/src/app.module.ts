import { Module } from "@blixis/core";
import { consoleTransport, LoggerModule } from "@blixis/logging";
import { ConfigModule } from "./config.js";
import { PostsModule } from "./posts/posts.module.js";

@Module({
  imports: [
    ConfigModule.forRoot(),
    LoggerModule.forRoot({ transports: [consoleTransport()] }),
    PostsModule,
  ],
})
export class AppModule {}
