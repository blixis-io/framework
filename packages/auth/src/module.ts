import { Module, type DynamicModule, type ModuleRef } from "@blixis-io/core";
import { Inject, Injectable, InjectionToken, type Class, type Provider, type Token } from "@blixis-io/di";
import {
  getRouteMetadata,
  GlobalGuard,
  RequestContext,
  SetRouteMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@blixis-io/http";
import { jwtVerify } from "jose";
import type { ZodType, z } from "zod";
import { API_KEY_HEADER, createApiKeyVerifier, type ApiKeyOptions, type ApiKeyStore, type ApiKeyVerifier } from "./api-keys.js";
import {
  createAuthServiceClass,
  type AuthService,
  type CredentialStore,
  type NormalizedIssuingOptions,
  type RefreshTokenStore,
} from "./issuing.js";

/** `WWW-Authenticate` values for a 401 from the bearer-token guards (RFC 6750). */
const BEARER_CHALLENGE = "Bearer";
const INVALID_TOKEN_CHALLENGE = 'Bearer error="invalid_token"';

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
  /**
   * Seconds after a refresh token is rotated during which presenting it again is a plain `401` that revokes nothing,
   * instead of being treated as theft. Default `0`: any reuse revokes the login (or all of the subject's sessions, if the
   * store has no families). Set a few seconds (10 is plenty) if clients can refresh twice at once, two tabs say, or retry
   * a refresh whose response was lost. The cost: a stolen token replayed inside the window is also just rejected, not
   * punished. The client must use the newest token it received.
   */
  refreshReuseGraceSeconds?: number | undefined;
}

/** The auth module was configured with something it can't work securely with. Thrown from `forRoot()`, so it fails at boot. */
export class AuthConfigError extends Error {
  override readonly name = "AuthConfigError";
}

/** Minimum HMAC key length in bytes: the size of the hash output (RFC 7518, section 3.2). */
const MIN_SECRET_BYTES = { HS256: 32, HS384: 48, HS512: 64 } as const;

export interface AuthModuleOptions<Claims = unknown> {
  /**
   * HMAC secret used to sign and verify tokens. At least 32 bytes for HS256, 48 for HS384, 64 for HS512
   * (counted in bytes of the UTF-8 encoding), or `forRoot()` throws `AuthConfigError`. Use random bytes, for
   * example `openssl rand -base64 48`.
   */
  secret: string;
  /** Defaults to `"HS256"`. */
  algorithm?: "HS256" | "HS384" | "HS512";
  /**
   * Expected `iss` claim. When set, a token must carry exactly this issuer to be accepted, and tokens issued by
   * `AUTH_SERVICE` carry it. Set it when more than one app or environment shares a secret, so one's tokens aren't
   * accepted by another. When unset, `iss` is neither checked nor added.
   */
  issuer?: string;
  /**
   * Expected `aud` claim: a token must list this audience (any of them, if you give several), and tokens issued by
   * `AUTH_SERVICE` carry it. When unset, `aud` is neither checked nor added.
   */
  audience?: string | readonly string[];
  /** Makes `JwtAuthGuard` (and `AUTH_SERVICE`, if `issuing` is set) visible to every module without each one importing this one directly. Defaults to `false`. */
  global?: boolean;
  /**
   * Require authentication on **every** route unless it is marked `@Public()`, and enforce `@Roles(...)`
   * wherever it is used. Defaults to `false`: nothing changes until you opt in, and then protection is on by
   * default. Without it, add `@UseGuards(AuthGuard)` to the controllers or routes you want protected.
   */
  protectAllRoutes?: boolean;
  /** Omit for a verify-only app (the original scope). Set to enable `AUTH_SERVICE` — password sign-in, refresh rotation, sign-out. */
  issuing?: IssuingOptions<Claims> | undefined;
  /**
   * Also accept an API key in the `x-api-key` header (`blx_<id>_<secret>`), checked against your store. A key resolves to
   * the same claims as a token, so `@Roles`, `getCurrentUser` and tenancy work unchanged. **When `x-api-key` is present it
   * is the credential, and the `Authorization` header is not looked at**: a bad key is a 401, never a fall back to a token.
   * Omit for tokens only (the `x-api-key` header is then ignored).
   */
  apiKeys?: ApiKeyOptions | undefined;
}

// `Symbol.for`, so metadata set with one copy of this package is read by another.
const ROLES_METADATA = Symbol.for("blixis:auth:roles");
const PUBLIC_METADATA = Symbol.for("blixis:auth:public");
const SCOPES_METADATA = Symbol.for("blixis:auth:scopes");

/**
 * Requires the authenticated user to hold at least one of `roles` (read from the token's `roles` claim).
 * On a controller it covers every route in it; on a route it replaces the controller's. Only takes effect
 * where `AuthGuard` runs: everywhere with `protectAllRoutes: true`, otherwise on routes that carry
 * `@UseGuards(AuthGuard)`. An unauthenticated request is a 401, a missing role a 403.
 */
export function Roles(...roles: readonly string[]): ClassDecorator & MethodDecorator {
  return SetRouteMetadata(ROLES_METADATA, [...roles]);
}

/**
 * Requires an **API key** to hold **all** of `scopes` (the key's `scopes`, as stored). A key without one of them is a 403.
 * It limits keys only: a request authenticated with a token is not affected, because a person's permissions come from
 * their roles and membership, not from scopes. On a controller it covers every route in it; on a route it replaces the
 * controller's. Like `@Roles`, it only takes effect where `AuthGuard` runs. Pair it with `apiKeys.scopedRoutesOnly` so a key
 * cannot reach a route that forgot to say what it needs.
 */
export function RequireScopes(...scopes: readonly string[]): ClassDecorator & MethodDecorator {
  return SetRouteMetadata(SCOPES_METADATA, [...scopes]);
}

/** Skips authentication for a route (or every route in a controller): the right place for a login or health endpoint when `protectAllRoutes` is on. */
export function Public(): ClassDecorator & MethodDecorator {
  return SetRouteMetadata(PUBLIC_METADATA, true);
}

/** The `roles` claim of a verified user, whatever shape the claims schema gave it. */
function rolesOf(user: unknown): unknown {
  return typeof user === "object" && user !== null ? Reflect.get(user, "roles") : undefined;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export interface NormalizedAuthOptions {
  key: Uint8Array;
  algorithm: string;
  issuer?: string | undefined;
  audience?: string | readonly string[] | undefined;
}

// One `RequestContext` key per `defineAuthModule()` call, not a fixed
// literal — otherwise two calls in the same app (two different claims
// shapes) would read/write the same slot and clobber each other.
let authInstanceCounter = 0;

/**
 * Builds a `JwtAuthGuard` + `createRolesGuard` bound to one claims schema,
 * same factory-closure shape as `@blixis-io/config`'s `defineConfigModule` —
 * the claims shape is app-specific, so there's no single fixed type to
 * validate against.
 */
export function defineAuthModule<Schema extends ZodType>(
  claimsSchema: Schema,
): {
  AuthModule: { forRoot(options: AuthModuleOptions<z.infer<Schema>>): DynamicModule };
  JwtAuthGuard: Class<CanActivate>;
  /** Authenticates the request unless the route is `@Public()`, then enforces `@Roles(...)`. Use it with `@UseGuards(AuthGuard)`, or let `protectAllRoutes` apply it everywhere. */
  AuthGuard: Class<CanActivate>;
  createRolesGuard: (...roles: readonly string[]) => Class<CanActivate>;
  getCurrentUser: (ctx: RequestContext) => z.infer<Schema> | undefined;
  /** Resolvable only when `forRoot({ issuing })` was set — otherwise `MissingProviderError` at boot. */
  AUTH_SERVICE: InjectionToken<AuthService>;
  /** The API key that authenticated the current request (`undefined` for a token, or before the guard has run). */
  getCurrentApiKey: (ctx: RequestContext) => { id: string; scopes: readonly string[] } | undefined;
  /** Resolvable only when `forRoot({ apiKeys })` was set. For code that has to check a key itself. */
  API_KEY_STORE: InjectionToken<ApiKeyStore>;
} {
  type Claims = z.infer<Schema>;
  const AUTH_OPTIONS = new InjectionToken<NormalizedAuthOptions>("blixis.auth.options");
  const ISSUING_OPTIONS = new InjectionToken<NormalizedIssuingOptions>("blixis.auth.issuingOptions");
  const CREDENTIAL_STORE = new InjectionToken<CredentialStore<Claims>>("blixis.auth.credentialStore");
  const REFRESH_TOKEN_STORE = new InjectionToken<RefreshTokenStore>("blixis.auth.refreshTokenStore");
  const AUTH_SERVICE = new InjectionToken<AuthService>("blixis.auth.service");
  const API_KEY_STORE = new InjectionToken<ApiKeyStore>("blixis.auth.apiKeyStore");
  /** `null` when API keys are not configured, so the guards can always inject it. */
  const API_KEY_VERIFIER = new InjectionToken<ApiKeyVerifier<Claims> | null>("blixis.auth.apiKeyVerifier");
  const instance = authInstanceCounter++;
  const CURRENT_USER_KEY = `blixis.auth.currentUser.${instance}`;
  const CURRENT_API_KEY = `blixis.auth.currentApiKey.${instance}`;

  function getCurrentApiKey(ctx: RequestContext): { id: string; scopes: readonly string[] } | undefined {
    return ctx.get<{ id: string; scopes: readonly string[] }>(CURRENT_API_KEY);
  }

  /** Reads the claims `JwtAuthGuard` verified for the current request, or `undefined` outside a request (or before the guard has run). */
  function getCurrentUser(ctx: RequestContext): Claims | undefined {
    return ctx.get<Claims>(CURRENT_USER_KEY);
  }

  /** Verifies the bearer token, validates its claims, and stores them as the current user. Throws `UnauthorizedException`. */
  async function authenticate(request: Request, options: NormalizedAuthOptions, ctx: RequestContext, apiKeys: ApiKeyVerifier<Claims> | null): Promise<Claims> {
    // An API key, when configured and presented, is the credential: a bad one is a 401 and never falls back to a token.
    if (apiKeys && request.headers.has(API_KEY_HEADER)) {
      const key = await apiKeys.verify(request);
      ctx.set(CURRENT_USER_KEY, key.claims);
      ctx.set(CURRENT_API_KEY, { id: key.id, scopes: key.scopes });
      return key.claims;
    }

    // RFC 7235: the scheme is case-insensitive and may be followed by more than one space.
    const token = /^bearer[ \t]+(\S+)[ \t]*$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token) {
      // RFC 6750: no credentials at all gets the bare scheme, with no error code.
      throw new UnauthorizedException("Missing or malformed Authorization header", BEARER_CHALLENGE);
    }

    let payload: unknown;
    try {
      payload = (
        await jwtVerify(token, options.key, {
          algorithms: [options.algorithm],
          // A token that never expires is a token that can never be revoked by waiting.
          requiredClaims: ["exp"],
          ...(options.issuer === undefined ? {} : { issuer: options.issuer }),
          ...(options.audience === undefined ? {} : { audience: typeof options.audience === "string" ? options.audience : [...options.audience] }),
        })
      ).payload;
    } catch {
      throw new UnauthorizedException("Invalid or expired token", INVALID_TOKEN_CHALLENGE);
    }

    const parsed = await claimsSchema.safeParseAsync(payload);
    if (!parsed.success) {
      throw new UnauthorizedException("Token payload failed validation", INVALID_TOKEN_CHALLENGE);
    }

    ctx.set(CURRENT_USER_KEY, parsed.data);
    return parsed.data;
  }

  @Injectable()
  class JwtAuthGuard implements CanActivate {
    constructor(
      @Inject(AUTH_OPTIONS) private readonly options: NormalizedAuthOptions,
      private readonly ctx: RequestContext,
    ) {}

    async canActivate({ request }: ExecutionContext): Promise<boolean> {
      // Tokens only, on purpose: scopes are enforced by `AuthGuard`, so a key must not get in through a guard that cannot check them.
      await authenticate(request, this.options, this.ctx, null);
      return true;
    }
  }

  /** A fresh guard class per call: the global one has to be a different class from the one used with `@UseGuards`, since only it is marked `@GlobalGuard()`. */
  function createAuthGuard(): Class<CanActivate> {
    @Injectable()
    class AuthGuardImpl implements CanActivate {
      constructor(
        @Inject(AUTH_OPTIONS) private readonly options: NormalizedAuthOptions,
        private readonly ctx: RequestContext,
        @Inject(API_KEY_VERIFIER) private readonly apiKeys: ApiKeyVerifier<Claims> | null,
      ) {}

      async canActivate(context: ExecutionContext): Promise<boolean> {
        if (getRouteMetadata(PUBLIC_METADATA, context) === true) {
          return true;
        }

        const user = await authenticate(context.request, this.options, this.ctx, this.apiKeys);

        const key = getCurrentApiKey(this.ctx);
        if (key) {
          // Only API keys are held to scopes. A key may reach a route only if the route says what it needs, when asked to.
          const needed = getRouteMetadata(SCOPES_METADATA, context);
          if (!isStringArray(needed) || needed.length === 0) {
            if (this.apiKeys?.scopedRoutesOnly) {
              return false;
            }
          } else if (!needed.every((scope) => key.scopes.includes(scope))) {
            return false;
          }
        }

        const required = getRouteMetadata(ROLES_METADATA, context);
        if (isStringArray(required) && required.length > 0) {
          const held = rolesOf(user);
          return isStringArray(held) && required.some((role) => held.includes(role));
        }
        return true;
      }
    }
    return AuthGuardImpl;
  }

  const AuthGuard = createAuthGuard();
  const GlobalAuthGuard = createAuthGuard();
  GlobalGuard()(GlobalAuthGuard);

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
      const algorithm = options.algorithm ?? "HS256";
      const key = new TextEncoder().encode(options.secret);
      if (key.length < MIN_SECRET_BYTES[algorithm]) {
        // The length, never the value: this message ends up in logs.
        throw new AuthConfigError(
          `AuthModule.forRoot(): the secret is ${key.length} bytes, but ${algorithm} needs at least ${MIN_SECRET_BYTES[algorithm]} bytes (RFC 7518, section 3.2). Use a random secret, for example from \`openssl rand -base64 48\` (64 characters, enough for every algorithm).`,
        );
      }
      const normalized: NormalizedAuthOptions = {
        key,
        algorithm,
        issuer: options.issuer,
        audience: options.audience,
      };
      const imports: ModuleRef[] = [];
      const providers: Provider[] = [{ provide: AUTH_OPTIONS, useValue: normalized }, JwtAuthGuard, AuthGuard];
      const exports: Token[] = [AUTH_OPTIONS, JwtAuthGuard, AuthGuard];

      if (options.apiKeys) {
        const apiKeyOptions = options.apiKeys;
        for (const [name, value] of [["cacheSeconds", apiKeyOptions.cacheSeconds], ["lastUsedIntervalSeconds", apiKeyOptions.lastUsedIntervalSeconds]] as const) {
          if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
            throw new AuthConfigError(`AuthModule.forRoot(): apiKeys.${name} must be a number of seconds, 0 or more (got ${value}).`);
          }
        }
        imports.push(...(apiKeyOptions.imports ?? []));
        providers.push(
          { provide: API_KEY_STORE, useClass: apiKeyOptions.store },
          {
            provide: API_KEY_VERIFIER,
            useFactory: (store: ApiKeyStore) =>
              createApiKeyVerifier<Claims>({
                store,
                options: { clientIp: apiKeyOptions.clientIp, cacheSeconds: apiKeyOptions.cacheSeconds, lastUsedIntervalSeconds: apiKeyOptions.lastUsedIntervalSeconds, scopedRoutesOnly: apiKeyOptions.scopedRoutesOnly },
                parseClaims: async (value) => {
                  const parsed = await claimsSchema.safeParseAsync(value);
                  return parsed.success ? { success: true, data: parsed.data } : { success: false };
                },
              }),
            inject: [API_KEY_STORE],
          },
        );
        exports.push(API_KEY_STORE);
      } else {
        providers.push({ provide: API_KEY_VERIFIER, useValue: null });
      }

      if (options.protectAllRoutes) {
        providers.push(GlobalAuthGuard);
      }

      if (options.issuing) {
        const issuingNormalized: NormalizedIssuingOptions = {
          accessTokenTtlSeconds: options.issuing.accessTokenTtl ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
          refreshTokenTtlSeconds: options.issuing.refreshTokenTtl ?? DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
          refreshReuseGraceSeconds: options.issuing.refreshReuseGraceSeconds ?? 0,
        };
        if (!Number.isFinite(issuingNormalized.refreshReuseGraceSeconds) || issuingNormalized.refreshReuseGraceSeconds < 0) {
          throw new AuthConfigError(
            `AuthModule.forRoot(): issuing.refreshReuseGraceSeconds must be a number of seconds, 0 or more (got ${issuingNormalized.refreshReuseGraceSeconds}).`,
          );
        }
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

  return { AuthModule, JwtAuthGuard, AuthGuard, createRolesGuard, getCurrentUser, getCurrentApiKey, AUTH_SERVICE, API_KEY_STORE };
}
