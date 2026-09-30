/**
 * Thrown by `requireTenant()` and `tenantScope()` when there's no tenant in
 * the current request context — the fail-closed guarantee: neither ever
 * falls back to returning unscoped data.
 */
export class MissingTenantError extends Error {
  constructor() {
    super(
      "No tenant in request context — apply TenantScopedGuard to this route first, or this was called outside a tenant-scoped request.",
    );
    this.name = "MissingTenantError";
  }
}
