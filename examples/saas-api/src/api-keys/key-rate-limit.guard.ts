import { Inject, Injectable, InjectionToken } from "@blixis-io/di";
import { HttpException, RequestContext, type CanActivate } from "@blixis-io/http";
import { getCurrentApiKey } from "../auth/auth.js";
import { DATABASE, type Database } from "../db/index.js";
import { DrizzleRateLimitStore } from "../platform/rate-limit-store.js";

/** Requests per minute per API key. */
export const KEY_RATE_LIMIT = new InjectionToken<number>("KEY_RATE_LIMIT");

/**
 * A limit **per API key**, counted after the key has been verified. It cannot be a middleware keyed on the key in the
 * header: middleware runs before authentication, so anyone could send someone else's key id (without the secret) and use
 * up that key's allowance. After the guard, the id is a verified one. The IP limiter in `app.ts` still runs first and
 * covers everything that is not yet a key.
 */
@Injectable()
export class KeyRateLimitGuard implements CanActivate {
  readonly #store: DrizzleRateLimitStore;

  constructor(
    private readonly ctx: RequestContext,
    @Inject(DATABASE) db: Database,
    @Inject(KEY_RATE_LIMIT) private readonly limit: number,
  ) {
    this.#store = new DrizzleRateLimitStore(() => db);
  }

  async canActivate(): Promise<boolean> {
    const key = getCurrentApiKey(this.ctx);
    if (!key) {
      return true; // a person: the per-address limit already applies
    }
    const windowMs = 60_000;
    const hit = await this.#store.hit(`api-key:${key.id}`, windowMs);
    if (hit.count > this.limit) {
      const seconds = Math.max(1, Math.ceil((hit.resetAt - Date.now()) / 1000));
      throw new HttpException(429, "Too Many Requests", undefined, { "retry-after": String(seconds) });
    }
    return true;
  }
}
