import { ApiOperation, ApiTags, Controller, Get, RequestContext, Returns, UnauthorizedException } from "@blixis-io/http";
import { Inject } from "@blixis-io/di";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser } from "../auth/auth.js";
import { DATABASE, type Database } from "../db/index.js";
import { memberships, organizations, spaces } from "../db/schema.js";

const MeSchema = z.object({
  id: z.string(),
  email: z.string(),
  spaces: z.array(z.object({ id: z.string(), name: z.string(), organization: z.string(), role: z.string() })),
});

@ApiTags("account")
@Controller("me")
export class SpacesController {
  constructor(
    private readonly ctx: RequestContext,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  /** Who the caller is and which spaces they may act in: where a client finds the `:spaceId` for the other routes. */
  @Get()
  @Returns(MeSchema)
  @ApiOperation({ summary: "The signed-in user and the spaces they belong to" })
  async me() {
    const user = getCurrentUser(this.ctx);
    if (!user) {
      throw new UnauthorizedException();
    }
    const rows = await this.db
      .select({ id: spaces.id, name: spaces.name, organization: organizations.name, role: memberships.role })
      .from(memberships)
      .innerJoin(spaces, eq(memberships.spaceId, spaces.id))
      .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
      .where(eq(memberships.userId, user.sub));
    return { id: user.sub, email: user.email, spaces: rows };
  }
}
