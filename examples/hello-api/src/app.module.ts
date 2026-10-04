import { Module } from "@blixis-io/core";
import { consoleTransport, LoggerModule } from "@blixis-io/logging";
import { ConfigModule } from "./config.js";
import { EventsModule } from "./events.js";
import { HealthController } from "./health/health.controller.js";
import { PostsModule } from "./posts/posts.module.js";

@Module({
  imports: [
    ConfigModule.forRoot(),
    LoggerModule.forRoot({ transports: [consoleTransport()] }),
    EventsModule.forRoot({ global: true }),
    PostsModule,
  ],
  // No dedicated module for this one — a single provider-less route isn't
  // worth its own module, unlike PostsModule.
  controllers: [HealthController],
})
export class AppModule {}
