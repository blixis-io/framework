import { Injectable } from "@blixis/di";
import type { CanActivate, ExecutionContext } from "@blixis/http";

// Dev-only stub: a real CMS auth guard would resolve a UserService/config
// here, which is exactly why guards go through DI instead of `new`.
const DEV_API_KEY = "dev-secret";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return context.request.headers.get("x-api-key") === DEV_API_KEY;
  }
}
