import { Module, type DynamicModule, type ModuleRef } from "@blixis/core";
import { Inject, Injectable, InjectionToken, type Class, type Provider, type Token } from "@blixis/di";
import { RequestContext, UnauthorizedException, type CanActivate, type ExecutionContext } from "@blixis/http";
import { jwtVerify } from "jose";
import type { ZodType, z } from "zod";
import {
  createAuthServiceClass,
  type AuthService,
  type CredentialStore,
  type NormalizedIssuingOptions,
  type RefreshTokenStore,
} from "./issuing.js";

const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 900; // 15 minutes
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 2_592_000; // 30 days

export interface IssuingOptions<Claims> {
  /**
   * Modules to import alongside `AuthModule` itself, so `credentialStore`
   * and `refreshTokenStore` can see whatever they depend on (e.g. a
   * `DATABASE` token exported by a `DbModule`). Without the exporting
   * module listed here, module encapsulation throws `ProviderNotVisibleError`.
   */
  imports?: ModuleRef[] | undefined;
  /** The app's own store implementation — a DI class, so it can inject `DATABASE` or anything else it needs. */
  credentialStore: Class<CredentialStore<Claims>>;
  /** The app's own store implementation for issued refresh tokens. */
  refreshTokenStore: Class<RefreshTokenStore>;
  /** Seconds. Defaults to 900 (15 minutes). */
  accessTokenTtl?: number | undefined;
  /** Seconds. Defaults to 2,592,000 (30 days). */
  refreshTokenTtl?: number | undefined;
}

export interface AuthModuleOptions<Claims = unknown> {
  /** HMAC secret used to verify the token's signature. */
  secret: string;
  /** Defaults to `"HS256"`. */
  algorithm?: "HS256" | "HS384" | "HS512";
  /** Makes `JwtAuthGuard` (and `AUTH_SERVICE`, if `issuing` is set) visible to every module without each one importing this one directly. Defaults to `false`. */
  global?: boolean;
  /** Omit for a verify-only app (the original scope). Set to enable `AUTH_SERVICE` — password sign-in, refresh rotation, sign-out. */
  issuing?: IssuingOptions<Claims> | undefined;
}

export interface NormalizedAuthOptions {
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
  AuthModule: { forRoot(options: AuthModuleOptions<z.infer<Schema>>): DynamicModule };
  JwtAuthGuard: Class<CanActivate>;
  createRolesGuard: (...roles: readonly string[]) => Class<CanActivate>;
  getCurrentUser: (ctx: RequestContext) => z.infer<Schema> | undefined;
  /** Resolvable only when `forRoot({ issuing })` was set — otherwise `MissingProviderError` at boot. */
  AUTH_SERVICE: InjectionToken<AuthService>;
} {
  type Claims = z.infer<Schema>;
  const AUTH_OPTIONS = new InjectionToken<NormalizedAuthOptions>("blixis.auth.options");
  const ISSUING_OPTIONS = new InjectionToken<NormalizedIssuingOptions>("blixis.auth.issuingOptions");
  const CREDENTIAL_STORE = new InjectionToken<CredentialStore<Claims>>("blixis.auth.credentialStore");
  const REFRESH_TOKEN_STORE = new InjectionToken<RefreshTokenStore>("blixis.auth.refreshTokenStore");
  const AUTH_SERVICE = new InjectionToken<AuthService>("blixis.auth.service");
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
    static forRoot(options: AuthModuleOptions<Claims>): DynamicModule {
      const normalized: NormalizedAuthOptions = {
        key: new TextEncoder().encode(options.secret),
        algorithm: options.algorithm ?? "HS256",
      };
      const imports: ModuleRef[] = [];
      const providers: Provider[] = [{ provide: AUTH_OPTIONS, useValue: normalized }, JwtAuthGuard];
      const exports: Token[] = [AUTH_OPTIONS, JwtAuthGuard];

      if (options.issuing) {
        const issuingNormalized: NormalizedIssuingOptions = {
          accessTokenTtlSeconds: options.issuing.accessTokenTtl ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
          refreshTokenTtlSeconds: options.issuing.refreshTokenTtl ?? DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
        };
        const AuthServiceImpl = createAuthServiceClass<Claims>({
          claimsSchema,
          authOptionsToken: AUTH_OPTIONS,
          issuingOptionsToken: ISSUING_OPTIONS,
          credentialStoreToken: CREDENTIAL_STORE,
          refreshTokenStoreToken: REFRESH_TOKEN_STORE,
        });

        imports.push(...(options.issuing.imports ?? []));
        providers.push(
          { provide: ISSUING_OPTIONS, useValue: issuingNormalized },
          { provide: CREDENTIAL_STORE, useClass: options.issuing.credentialStore },
          { provide: REFRESH_TOKEN_STORE, useClass: options.issuing.refreshTokenStore },
          { provide: AUTH_SERVICE, useClass: AuthServiceImpl },
        );
        exports.push(AUTH_SERVICE);
      }

      return { module: AuthModule, imports, providers, exports, global: options.global ?? false };
    }
  }

  return { AuthModule, JwtAuthGuard, createRolesGuard, getCurrentUser, AUTH_SERVICE };
}
