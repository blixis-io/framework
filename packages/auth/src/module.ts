import { Module, type DynamicModule } from "@blixis/core";
import { Inject, Injectable, InjectionToken, type Class } from "@blixis/di";
import { RequestContext, UnauthorizedException, type CanActivate, type ExecutionContext } from "@blixis/http";
import { jwtVerify } from "jose";
import type { ZodType, z } from "zod";

export interface AuthModuleOptions {
  /** HMAC secret used to verify the token's signature. */
  secret: string;
  /** Defaults to `"HS256"`. */
  algorithm?: "HS256" | "HS384" | "HS512";
  /** Makes `JwtAuthGuard` visible to every module without each one importing this one directly. Defaults to `false`. */
  global?: boolean;
}

interface NormalizedAuthOptions {
  key: Uint8Array;
  algorithm: string;
}

// One `RequestContext` key per `defineAuthModule()` call, not a fixed
// literal — otherwise two calls in the same app (two different claims
// shapes) would read/write the same slot and clobber each other.
let authInstanceCounter = 0;

/**
 * Builds a `JwtAuthGuard` + `createRolesGuard` bound to one claims schema,
 * same factory-closure shape as `@blixis/config`'s `defineConfigModule` —
 * the claims shape is app-specific, so there's no single fixed type to
 * validate against.
 */
export function defineAuthModule<Schema extends ZodType>(
  claimsSchema: Schema,
): {
  AuthModule: { forRoot(options: AuthModuleOptions): DynamicModule };
  JwtAuthGuard: Class<CanActivate>;
  createRolesGuard: (...roles: readonly string[]) => Class<CanActivate>;
  getCurrentUser: (ctx: RequestContext) => z.infer<Schema> | undefined;
} {
  type Claims = z.infer<Schema>;
  const AUTH_OPTIONS = new InjectionToken<NormalizedAuthOptions>("blixis.auth.options");
  const CURRENT_USER_KEY = `blixis.auth.currentUser.${authInstanceCounter++}`;

  /** Reads the claims `JwtAuthGuard` verified for the current request, or `undefined` outside a request (or before the guard has run). */
  function getCurrentUser(ctx: RequestContext): Claims | undefined {
    return ctx.get<Claims>(CURRENT_USER_KEY);
  }

  @Injectable()
  class JwtAuthGuard implements CanActivate {
    constructor(
      @Inject(AUTH_OPTIONS) private readonly options: NormalizedAuthOptions,
      private readonly ctx: RequestContext,
    ) {}

    async canActivate({ request }: ExecutionContext): Promise<boolean> {
      const header = request.headers.get("authorization") ?? "";
      const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
      if (!token) {
        throw new UnauthorizedException("Missing or malformed Authorization header");
      }

      let payload: unknown;
      try {
        payload = (await jwtVerify(token, this.options.key, { algorithms: [this.options.algorithm] })).payload;
      } catch {
        throw new UnauthorizedException("Invalid or expired token");
      }

      const parsed = await claimsSchema.safeParseAsync(payload);
      if (!parsed.success) {
        throw new UnauthorizedException("Token payload failed validation");
      }

      this.ctx.set(CURRENT_USER_KEY, parsed.data);
      return true;
    }
  }

  /**
   * Builds a guard requiring at least one of `roles` on the current user —
   * a fresh class per call, meant to be assigned to a named export and
   * registered as a provider like any other guard (`export const AdminGuard
   * = createRolesGuard("admin")`). Must run after `JwtAuthGuard` in the
   * same `@UseGuards(...)` list; throws `UnauthorizedException` (not a
   * plain `false`) if no user is in `RequestContext` yet, since that means
   * the guards were ordered wrong, not that this user lacks the role.
   */
  function createRolesGuard(...roles: readonly string[]): Class<CanActivate> {
    @Injectable()
    class RolesGuard implements CanActivate {
      constructor(private readonly ctx: RequestContext) {}

      canActivate(): boolean {
        const user = getCurrentUser(this.ctx);
        if (!user) {
          throw new UnauthorizedException("No authenticated user in request context — apply the auth guard first");
        }
        const userRoles = (user as { roles?: unknown }).roles;
        return Array.isArray(userRoles) && roles.some((role) => userRoles.includes(role));
      }
    }
    return RolesGuard;
  }

  @Module()
  class AuthModule {
    static forRoot(options: AuthModuleOptions): DynamicModule {
      const normalized: NormalizedAuthOptions = {
        key: new TextEncoder().encode(options.secret),
        algorithm: options.algorithm ?? "HS256",
      };
      return {
        module: AuthModule,
        providers: [{ provide: AUTH_OPTIONS, useValue: normalized }, JwtAuthGuard],
        exports: [AUTH_OPTIONS, JwtAuthGuard],
        global: options.global ?? false,
      };
    }
  }

  return { AuthModule, JwtAuthGuard, createRolesGuard, getCurrentUser };
}
