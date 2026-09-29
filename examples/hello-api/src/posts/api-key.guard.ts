import { Injectable } from "@blixis/di";
import { RequestContext, type CanActivate, type ExecutionContext } from "@blixis/http";

// Dev-only stub: a real CMS auth guard would resolve a UserService/config
// here, which is exactly why guards go through DI instead of `new`.
const DEV_API_KEY = "dev-secret";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly ctx: RequestContext) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = context.request.headers.get("x-api-key") === DEV_API_KEY;
    if (allowed) {
      // Set for this request only — PostsService reads it back to attribute
      // the action, demonstrating RequestContext without a real user store.
      this.ctx.set("apiClient", "dev-cli");
    }
    return allowed;
  }
}
