import { Module, type DynamicModule } from "@blixis-io/core";
import { Injectable, type Class } from "@blixis-io/di";
import {
  NotFoundException,
  RequestContext,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@blixis-io/http";
import { MissingTenantError } from "./errors.js";

export interface TenantContext {
  organizationId: string;
  spaceId: string;
  /** Defaults to `"main"` when the route has no `:environment` param. */
  environmentId: string;
  role: string;
}

export interface Membership {
  organizationId: string;
  role: string;
}

export interface TenancyModuleOptions<Actor> {
  /** Reads the current actor out of RequestContext — app-provided, since this package doesn't know which auth mechanism populated it. */
  getActor: (ctx: RequestContext) => Actor | undefined;
  /**
   * Given the actor and a `spaceId` (from the route), returns their
   * membership, or `null`/`undefined` if they have none. Called on every
   * tenant-scoped request — a `null` result becomes a `404`, never a
   * `403`, so a non-member can't tell a space exists at all.
   */
  resolveMembership: (
    actor: Actor,
    spaceId: string,
  ) => Membership | null | undefined | Promise<Membership | null | undefined>;
}

export interface TenancyForRootOptions {
  /** Makes `TenantScopedGuard` visible to every module without each one importing this one directly. Defaults to `false`. */
  global?: boolean;
}

// One RequestContext key per defineTenancyModule() call, not a fixed
// literal — otherwise two calls in the same app would read/write the same
// slot and clobber each other. (Real bug found this exact way in
// @blixis-io/auth; fixed proactively here.)
let tenancyInstanceCounter = 0;

/** For a resource loaded another way (e.g. by id, via another module's service) — confirms it actually belongs to the current tenant. Mismatch is a 404, not a 403, same fail-closed reasoning as everywhere else here. Doesn't need any per-`defineTenancyModule()` state, so it's a plain module-level export, not part of the closure. */
export function assertSameTenant(resourceSpaceId: string, tenant: TenantContext): void {
  if (resourceSpaceId !== tenant.spaceId) {
    throw new NotFoundException();
  }
}

/**
 * Builds a `TenantScopedGuard` bound to one membership-resolution strategy.
 * Owns the request-scoping *mechanism* only — no Organization/Space/
 * Membership data model or CRUD lives here; that's app-specific CMS domain
 * data, supplied via `resolveMembership`.
 */
export function defineTenancyModule<Actor>(
  options: TenancyModuleOptions<Actor>,
): {
  TenancyModule: { forRoot(forRootOptions?: TenancyForRootOptions): DynamicModule };
  TenantScopedGuard: Class<CanActivate>;
  getTenant: (ctx: RequestContext) => TenantContext | undefined;
  requireTenant: (ctx: RequestContext) => TenantContext;
  assertSameTenant: (resourceSpaceId: string, tenant: TenantContext) => void;
} {
  const TENANT_KEY = `blixis.tenancy.tenant.${tenancyInstanceCounter++}`;

  function getTenant(ctx: RequestContext): TenantContext | undefined {
    return ctx.get<TenantContext>(TENANT_KEY);
  }

  function requireTenant(ctx: RequestContext): TenantContext {
    const tenant = getTenant(ctx);
    if (!tenant) {
      throw new MissingTenantError();
    }
    return tenant;
  }

  @Injectable()
  class TenantScopedGuard implements CanActivate {
    constructor(private readonly ctx: RequestContext) {}

    async canActivate({ params }: ExecutionContext): Promise<boolean> {
      const spaceId = params["spaceId"];
      if (!spaceId) {
        throw new Error("TenantScopedGuard requires a :spaceId route param");
      }

      const actor = options.getActor(this.ctx);
      if (!actor) {
        throw new UnauthorizedException();
      }

      const membership = await options.resolveMembership(actor, spaceId);
      if (!membership) {
        throw new NotFoundException();
      }

      const tenant: TenantContext = {
        organizationId: membership.organizationId,
        spaceId,
        environmentId: params["environment"] ?? "main",
        role: membership.role,
      };
      this.ctx.set(TENANT_KEY, tenant);
      return true;
    }
  }

  @Module()
  class TenancyModule {
    static forRoot(forRootOptions: TenancyForRootOptions = {}): DynamicModule {
      return {
        module: TenancyModule,
        providers: [TenantScopedGuard],
        exports: [TenantScopedGuard],
        global: forRootOptions.global ?? false,
      };
    }
  }

  return { TenancyModule, TenantScopedGuard, getTenant, requireTenant, assertSameTenant };
}
