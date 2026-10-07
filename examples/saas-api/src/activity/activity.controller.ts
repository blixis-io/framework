import { ApiOperation, ApiTags, Controller, Get, RequestContext, Returns, UseGuards } from "@blixis-io/http";
import { z } from "zod";
import { KeyRateLimitGuard } from "../api-keys/key-rate-limit.guard.js";
import { RequireScopes } from "../auth/auth.js";
import { requireTenant, TenantScopedGuard } from "../tenancy/tenancy.js";
import { ActivityService } from "./activity.service.js";

const ActivityListSchema = z.array(z.object({ id: z.string(), message: z.string(), spaceId: z.string() }));

@ApiTags("activity")
@UseGuards(TenantScopedGuard, KeyRateLimitGuard)
@RequireScopes("projects:read")
@Controller("spaces/:spaceId/activity")
export class ActivityController {
  constructor(
    private readonly activity: ActivityService,
    private readonly ctx: RequestContext,
  ) {}

  @Get()
  @Returns(ActivityListSchema)
  @ApiOperation({ summary: "What happened in a space (written by the outbox consumer)" })
  list() {
    return this.activity.list(requireTenant(this.ctx));
  }
}
