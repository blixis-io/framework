import { Module } from "@blixis-io/core";
import { ActivityController } from "../activity/activity.controller.js";
import { ActivityService } from "../activity/activity.service.js";
import { TenancyModule } from "../tenancy/tenancy.js";
import { ProjectsController } from "./projects.controller.js";
import { ProjectsService } from "./projects.service.js";

@Module({
  imports: [TenancyModule.forRoot()],
  // The activity feed shares this module: the tenancy guard can be registered once, and the feed is a read of what projects did.
  providers: [ProjectsService, ActivityService],
  controllers: [ProjectsController, ActivityController],
})
export class ProjectsModule {}
