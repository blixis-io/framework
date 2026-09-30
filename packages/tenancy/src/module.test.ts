import { Module } from "@blixis-io/core";
import { createHttpApplication, NotFoundException, RequestContext, runInRequestContext, UnauthorizedException } from "@blixis-io/http";
import { describe, expect, it } from "vitest";
import { MissingTenantError } from "./errors.js";
import { defineTenancyModule, type Membership } from "./module.js";

interface Actor {
  id: string;
}

const ACTOR_KEY = "test.actor";

function setActor(ctx: RequestContext, actor: Actor): void {
  ctx.set(ACTOR_KEY, actor);
}

function buildTenancy(
  resolveMembership: (actor: Actor, spaceId: string) => Membership | null | undefined | Promise<Membership | null | undefined>,
) {
  return defineTenancyModule<Actor>({
    getActor: (ctx) => ctx.get<Actor>(ACTOR_KEY),
    resolveMembership,
  });
}

function requestWith(params: Record<string, string>) {
  return { request: new Request("http://localhost/"), params };
}

describe("defineTenancyModule", () => {
  it("grants access and populates the full tenant context on a real membership match", async () => {
    const tenancy = buildTenancy(async () => ({ organizationId: "org-1", role: "editor" }));
    const app = await createHttpApplication(tenancy.TenancyModule.forRoot());
    const guard = app.get(tenancy.TenantScopedGuard);
    const ctx = app.get(RequestContext);

    await runInRequestContext(async () => {
      setActor(ctx, { id: "user-1" });
      const allowed = await guard.canActivate(requestWith({ spaceId: "space-1", environment: "staging" }));

      expect(allowed).toBe(true);
      expect(tenancy.getTenant(ctx)).toEqual({
        organizationId: "org-1",
        spaceId: "space-1",
        environmentId: "staging",
        role: "editor",
      });
    });
  });

  it("defaults environmentId to main when the route has no :environment param", async () => {
    const tenancy = buildTenancy(() => ({ organizationId: "org-1", role: "viewer" }));
    const app = await createHttpApplication(tenancy.TenancyModule.forRoot());
    const guard = app.get(tenancy.TenantScopedGuard);
    const ctx = app.get(RequestContext);

    await runInRequestContext(async () => {
      setActor(ctx, { id: "user-1" });
      await guard.canActivate(requestWith({ spaceId: "space-1" }));

      expect(tenancy.getTenant(ctx)?.environmentId).toBe("main");
    });
  });

  it("rejects with UnauthorizedException when there's no actor in context", async () => {
    const tenancy = buildTenancy(() => ({ organizationId: "org-1", role: "editor" }));
    const app = await createHttpApplication(tenancy.TenancyModule.forRoot());
    const guard = app.get(tenancy.TenantScopedGuard);

    await runInRequestContext(() =>
      expect(guard.canActivate(requestWith({ spaceId: "space-1" }))).rejects.toThrow(UnauthorizedException),
    );
  });

  it("rejects with NotFoundException, not ForbiddenException, when resolveMembership returns null", async () => {
    const tenancy = buildTenancy(() => null);
    const app = await createHttpApplication(tenancy.TenancyModule.forRoot());
    const guard = app.get(tenancy.TenantScopedGuard);
    const ctx = app.get(RequestContext);

    await runInRequestContext(() => {
      setActor(ctx, { id: "user-1" });
      return expect(guard.canActivate(requestWith({ spaceId: "space-1" }))).rejects.toThrow(NotFoundException);
    });
  });

  it("rejects with NotFoundException when resolveMembership returns undefined", async () => {
    const tenancy = buildTenancy(() => undefined);
    const app = await createHttpApplication(tenancy.TenancyModule.forRoot());
    const guard = app.get(tenancy.TenantScopedGuard);
    const ctx = app.get(RequestContext);

    await runInRequestContext(() => {
      setActor(ctx, { id: "user-1" });
      return expect(guard.canActivate(requestWith({ spaceId: "space-1" }))).rejects.toThrow(NotFoundException);
    });
  });

  it("throws when the route has no :spaceId param — a misconfigured route, not a runtime access decision", async () => {
    const tenancy = buildTenancy(() => ({ organizationId: "org-1", role: "editor" }));
    const app = await createHttpApplication(tenancy.TenancyModule.forRoot());
    const guard = app.get(tenancy.TenantScopedGuard);

    await runInRequestContext(() => expect(guard.canActivate(requestWith({}))).rejects.toThrow(":spaceId"));
  });

  describe("getTenant / requireTenant", () => {
    it("getTenant returns undefined outside tenant scope", () => {
      const tenancy = buildTenancy(() => null);
      const ctx = new RequestContext();

      expect(tenancy.getTenant(ctx)).toBeUndefined();
    });

    it("requireTenant throws MissingTenantError outside tenant scope", () => {
      const tenancy = buildTenancy(() => null);
      const ctx = new RequestContext();

      expect(() => tenancy.requireTenant(ctx)).toThrow(MissingTenantError);
    });

    it("requireTenant returns the tenant once the guard has run", async () => {
      const tenancy = buildTenancy(() => ({ organizationId: "org-1", role: "editor" }));
      const app = await createHttpApplication(tenancy.TenancyModule.forRoot());
      const guard = app.get(tenancy.TenantScopedGuard);
      const ctx = app.get(RequestContext);

      await runInRequestContext(async () => {
        setActor(ctx, { id: "user-1" });
        await guard.canActivate(requestWith({ spaceId: "space-1" }));

        expect(tenancy.requireTenant(ctx).spaceId).toBe("space-1");
      });
    });
  });

  describe("assertSameTenant", () => {
    const tenant = { organizationId: "org-1", spaceId: "space-1", environmentId: "main", role: "editor" };

    it("passes when the resource's spaceId matches the tenant", () => {
      const tenancy = buildTenancy(() => null);

      expect(() => tenancy.assertSameTenant("space-1", tenant)).not.toThrow();
    });

    it("throws NotFoundException when the resource's spaceId doesn't match", () => {
      const tenancy = buildTenancy(() => null);

      expect(() => tenancy.assertSameTenant("space-2", tenant)).toThrow(NotFoundException);
    });
  });

  it("each call to defineTenancyModule produces its own distinct RequestContext slot — two instances never clobber each other", async () => {
    const a = buildTenancy(() => ({ organizationId: "org-1", role: "editor" }));
    const b = buildTenancy(() => ({ organizationId: "org-2", role: "viewer" }));

    @Module({ imports: [a.TenancyModule.forRoot(), b.TenancyModule.forRoot()] })
    class TestModule {}

    const app = await createHttpApplication(TestModule);
    const guardA = app.get(a.TenantScopedGuard);
    const ctx = app.get(RequestContext);

    await runInRequestContext(async () => {
      setActor(ctx, { id: "user-1" });
      await guardA.canActivate(requestWith({ spaceId: "space-1" }));

      expect(a.getTenant(ctx)).toBeDefined();
      expect(b.getTenant(ctx)).toBeUndefined();
    });
  });

  it("defaults to a non-global module", () => {
    const tenancy = buildTenancy(() => null);

    const dynamic = tenancy.TenancyModule.forRoot();

    expect(dynamic.global).toBe(false);
  });

  it("global: true makes TenantScopedGuard visible without a direct import", () => {
    const tenancy = buildTenancy(() => null);

    const dynamic = tenancy.TenancyModule.forRoot({ global: true });

    expect(dynamic.global).toBe(true);
  });
});
