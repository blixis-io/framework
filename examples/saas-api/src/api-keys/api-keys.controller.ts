import { ApiOperation, ApiTags, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Post, RequestContext, Returns, UseGuards } from "@blixis-io/http";
import { getCurrentApiKey, getCurrentUser } from "../auth/auth.js";
import { requireTenant, TenantScopedGuard } from "../tenancy/tenancy.js";
import { ApiKeyListSchema, CreateApiKeySchema, CreatedApiKeySchema, type CreateApiKeyInput } from "./api-key.schema.js";
import { ApiKeysService } from "./api-keys.service.js";

/**
 * Managing keys is for **people**, and for the space's owners only. A key can never mint or revoke keys: no route here
 * carries `@RequireScopes`, and the app runs with `scopedRoutesOnly`, so a key is refused before it gets this far; the
 * check below makes the rule explicit, and survives someone turning that option off.
 */
@ApiTags("api-keys")
@UseGuards(TenantScopedGuard)
@Controller("spaces/:spaceId/api-keys")
export class ApiKeysController {
  constructor(
    private readonly keys: ApiKeysService,
    private readonly ctx: RequestContext,
  ) {}

  private owner() {
    const tenant = requireTenant(this.ctx);
    const user = getCurrentUser(this.ctx);
    if (getCurrentApiKey(this.ctx) || !user || tenant.role !== "owner") {
      throw new ForbiddenException();
    }
    return { tenant, userId: user.sub };
  }

  @Post()
  @HttpCode(201)
  @Returns(CreatedApiKeySchema)
  @ApiOperation({ summary: "Create an API key for this space. The key is shown once, in this response only." })
  create(@Body(CreateApiKeySchema) body: CreateApiKeyInput) {
    const { tenant, userId } = this.owner();
    return this.keys.create(tenant, userId, body);
  }

  @Get()
  @Returns(ApiKeyListSchema)
  @ApiOperation({ summary: "List this space's API keys (never the keys themselves)" })
  list() {
    return this.keys.list(this.owner().tenant);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Revoke an API key at once" })
  revoke(@Param("id") id: string) {
    return this.keys.revoke(this.owner().tenant, id);
  }
}
