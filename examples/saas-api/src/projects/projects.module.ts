import { Module, type DynamicModule } from "@blixis-io/core";
import { ActivityController } from "../activity/activity.controller.js";
import { ActivityService } from "../activity/activity.service.js";
import { ApiKeysController } from "../api-keys/api-keys.controller.js";
import { ApiKeysService } from "../api-keys/api-keys.service.js";
import { KEY_RATE_LIMIT, KeyRateLimitGuard } from "../api-keys/key-rate-limit.guard.js";
import { TenancyModule } from "../tenancy/tenancy.js";
import { ProjectsController } from "./projects.controller.js";
import { ProjectsService } from "./projects.service.js";

/**
 * Everything that lives under `/spaces/:spaceId`. One module, because the tenancy guard can be registered once: the
 * activity feed and the API keys of a space share it with the projects.
 */
@Module({})
export class ProjectsModule {
  static forRoot(options: { keyRateLimitPerMinute: number }): DynamicModule {
    return {
      module: ProjectsModule,
      imports: [TenancyModule.forRoot()],
      providers: [ProjectsService, ActivityService, ApiKeysService, KeyRateLimitGuard, { provide: KEY_RATE_LIMIT, useValue: options.keyRateLimitPerMinute }],
      controllers: [ProjectsController, ActivityController, ApiKeysController],
    };
  }
}
