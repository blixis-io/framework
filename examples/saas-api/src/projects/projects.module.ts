import { Module } from "@blixis-io/core";
import { TenancyModule } from "../tenancy/tenancy.js";
import { ProjectsController } from "./projects.controller.js";
import { ProjectsService } from "./projects.service.js";

@Module({
  imports: [TenancyModule.forRoot()],
  providers: [ProjectsService],
  controllers: [ProjectsController],
})
export class ProjectsModule {}
