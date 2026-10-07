import { Module, type DynamicModule } from "@blixis-io/core";
import { type Class } from "@blixis-io/di";
import { AccountsService } from "./auth/accounts.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthModule } from "./auth/auth.js";
import { DrizzleCredentialStore } from "./auth/credential-store.js";
import { DrizzleRefreshTokenStore } from "./auth/refresh-token-store.js";
import { AppConfigSchema, ConfigModule } from "./config.js";
import { MigrateCommand } from "./db/migrate.command.js";
import { DrizzleModule } from "./db/index.js";
import { DatabaseHealth } from "./platform/database-health.js";
import { HealthModule } from "./platform/health.js";
import { OutboxModule } from "./outbox/outbox.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { SpacesController } from "./spaces/spaces.controller.js";
import { MembershipDirectoryWiring } from "./tenancy/wiring.js";

/** The whole module graph for one environment. A function, because the database and the auth secret come from config. */
export function createAppModule(env: Record<string, string | undefined>, hooks: { onOutboxError?: (error: unknown) => void } = {}): Class {
  const config = AppConfigSchema.parse(env);
  const imports: DynamicModule[] = [
    ConfigModule.forRoot(env),
    // Global, so the auth stores, the tenancy wiring and the health check can all inject DATABASE.
    DrizzleModule.forRoot({ connection: config.DATABASE_URL, global: true }),
    AuthModule.forRoot({
      secret: config.JWT_SECRET,
      // Every route needs a token unless it says `@Public()`: a controller added later cannot be forgotten and left open.
      protectAllRoutes: true,
      issuing: { credentialStore: DrizzleCredentialStore, refreshTokenStore: DrizzleRefreshTokenStore },
    }),
    HealthModule.forRoot(),
    OutboxModule.forRoot({ pollMs: config.OUTBOX_POLL_MS, maxAttempts: config.OUTBOX_MAX_ATTEMPTS, ...(hooks.onOutboxError ? { onError: hooks.onOutboxError } : {}) }),
  ];

  @Module({
    imports: [...imports, ProjectsModule],
    providers: [AccountsService, DatabaseHealth, MembershipDirectoryWiring, MigrateCommand],
    controllers: [AuthController, SpacesController],
  })
  class AppModule {}

  return AppModule;
}
