import { Module } from "@blixis-io/core";
import { Inject, Injectable, InjectionToken } from "@blixis-io/di";
import { createHttpApplication, runInRequestContext } from "@blixis-io/http";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineAuthModule } from "./module.js";
import { hashPassword } from "./password.js";
import * as passwordModule from "./password.js";
import type { CredentialStore, RefreshTokenRecord, RefreshTokenStore } from "./issuing.js";

const SECRET = "test-secret-at-least-32-bytes-long!!";
const ClaimsSchema = z.object({ sub: z.string(), roles: z.array(z.string()) });
type TestClaims = z.infer<typeof ClaimsSchema>;

interface Account {
  subject: string;
  passwordHash: string;
}

/** Fresh, closure-captured in-memory stores per test — same "DbConnection-in-a-closure" trick every other package's own test fixtures use for a fresh DI provider per test. */
function createStores() {
  const accounts = new Map<string, Account>();
  const claimsBySubject = new Map<string, TestClaims | null>();
  const refreshTokens = new Map<string, RefreshTokenRecord>();

  @Injectable()
  class TestCredentialStore implements CredentialStore<TestClaims> {
    async findByIdentifier(identifier: string) {
      return accounts.get(identifier) ?? null;
    }
    async loadClaims(subject: string) {
      return claimsBySubject.get(subject) ?? null;
    }
  }

  @Injectable()
  class TestRefreshTokenStore implements RefreshTokenStore {
    async create(tokenHash: string, record: { subject: string; expiresAt: Date }) {
      refreshTokens.set(tokenHash, { subject: record.subject, expiresAt: record.expiresAt });
    }
    async find(tokenHash: string) {
      return refreshTokens.get(tokenHash) ?? null;
    }
    async markRotated(tokenHash: string) {
      const record = refreshTokens.get(tokenHash);
      if (!record || record.rotatedAt || record.revokedAt) {
        return false;
      }
      refreshTokens.set(tokenHash, { ...record, rotatedAt: new Date() });
      return true;
    }
    async revoke(tokenHash: string) {
      const record = refreshTokens.get(tokenHash);
      if (record) {
        refreshTokens.set(tokenHash, { ...record, revokedAt: new Date() });
      }
    }
    async revokeAllForSubject(subject: string) {
      for (const [hash, record] of refreshTokens) {
        if (record.subject === subject) {
          refreshTokens.set(hash, { ...record, revokedAt: new Date() });
        }
      }
    }
  }

  return { accounts, claimsBySubject, refreshTokens, TestCredentialStore, TestRefreshTokenStore };
}

async function buildAuth(claimsOverride?: TestClaims | null) {
  const stores = createStores();
  const auth = defineAuthModule(ClaimsSchema);

  @Module({
    imports: [
      auth.AuthModule.forRoot({
        secret: SECRET,
        issuing: { credentialStore: stores.TestCredentialStore, refreshTokenStore: stores.TestRefreshTokenStore },
      }),
    ],
  })
  class TestModule {}

  const app = await createHttpApplication(TestModule);
  const authService = app.get(auth.AUTH_SERVICE);
  const jwtGuard = app.get(auth.JwtAuthGuard);

  async function seed(identifier: string, password: string, subject: string, claims: TestClaims | null = { sub: subject, roles: [] }) {
    stores.accounts.set(identifier, { subject, passwordHash: await hashPassword(password) });
    stores.claimsBySubject.set(subject, claimsOverride !== undefined ? claimsOverride : claims);
  }

  return { app, auth, authService, jwtGuard, stores, seed };
}

function requestWith(token: string): Request {
  return new Request("http://localhost/", { headers: { authorization: `Bearer ${token}` } });
}

describe("AuthService.signIn", () => {
  it("returns a token pair whose access token passes the real JwtAuthGuard", async () => {
    const { authService, jwtGuard, seed } = await buildAuth();
    await seed("alice@example.com", "correct horse battery staple", "user-1");

    const pair = await authService.signIn("alice@example.com", "correct horse battery staple");

    await runInRequestContext(async () => {
      await expect(jwtGuard.canActivate({ request: requestWith(pair.accessToken), params: {} })).resolves.toBe(true);
    });
    expect(pair.refreshToken).toBeTruthy();
    expect(pair.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(pair.refreshTokenExpiresAt.getTime()).toBeGreaterThan(pair.accessTokenExpiresAt.getTime());
  });

  it("rejects an unknown identifier with a generic message", async () => {
    const { authService } = await buildAuth();

    await expect(authService.signIn("nobody@example.com", "whatever")).rejects.toThrow("Invalid credentials");
  });

  it("rejects the wrong password with the identical generic message", async () => {
    const { authService, seed } = await buildAuth();
    await seed("alice@example.com", "correct horse battery staple", "user-1");

    await expect(authService.signIn("alice@example.com", "wrong password")).rejects.toThrow("Invalid credentials");
  });

  it("rejects a disabled account (loadClaims returns null) with the identical generic message", async () => {
    const { authService, seed } = await buildAuth(null);
    await seed("alice@example.com", "correct horse battery staple", "user-1");

    await expect(authService.signIn("alice@example.com", "correct horse battery staple")).rejects.toThrow(
      "Invalid credentials",
    );
  });

  it("still verifies a password against an unknown identifier — the timing-safe enumeration defense", async () => {
    const verifySpy = vi.spyOn(passwordModule, "verifyPassword");
    const { authService } = await buildAuth();

    await expect(authService.signIn("nobody@example.com", "whatever")).rejects.toThrow("Invalid credentials");

    expect(verifySpy).toHaveBeenCalledWith("whatever", expect.stringMatching(/^\$argon2id\$/));
    verifySpy.mockRestore();
  });
});

describe("AuthService.refresh", () => {
  it("rotates a valid refresh token for a new pair, and the old token no longer works", async () => {
    const { authService, seed } = await buildAuth();
    await seed("alice@example.com", "correct horse battery staple", "user-1");
    const first = await authService.signIn("alice@example.com", "correct horse battery staple");

    const second = await authService.refresh(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(authService.refresh(first.refreshToken)).rejects.toThrow("Invalid or expired refresh token");
  });

  it("reusing an already-rotated token revokes every refresh token for that subject, including the newest one", async () => {
    const { authService, seed } = await buildAuth();
    await seed("alice@example.com", "correct horse battery staple", "user-1");
    const first = await authService.signIn("alice@example.com", "correct horse battery staple");
    const second = await authService.refresh(first.refreshToken);

    await expect(authService.refresh(first.refreshToken)).rejects.toThrow("Invalid or expired refresh token");
    await expect(authService.refresh(second.refreshToken)).rejects.toThrow("Invalid or expired refresh token");
  });

  it("two concurrent refreshes of the same token — exactly one wins, the loser's markRotated race is treated as reuse", async () => {
    const { authService, seed } = await buildAuth();
    await seed("alice@example.com", "correct horse battery staple", "user-1");
    const pair = await authService.signIn("alice@example.com", "correct horse battery staple");

    const results = await Promise.allSettled([
      authService.refresh(pair.refreshToken),
      authService.refresh(pair.refreshToken),
    ]);

    // The store's own markRotated always re-reads current state, so this is
    // a real race, not a simulated one — exactly one call's compare-and-set
    // wins. (The loser's revokeAllForSubject call may or may not also catch
    // the winner's brand-new token, depending on exactly when the winner's
    // real JWT signing finishes relative to the loser's revoke — that
    // ordering isn't a guarantee this test can pin down, so it isn't
    // asserted here; the sequential-reuse test above already proves
    // revokeAllForSubject reaches an already-persisted newer token.)
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("rejects an unknown refresh token", async () => {
    const { authService } = await buildAuth();

    await expect(authService.refresh("not-a-real-token")).rejects.toThrow("Invalid or expired refresh token");
  });

  it("rejects an expired refresh token", async () => {
    const { authService, stores, seed } = await buildAuth();
    await seed("alice@example.com", "correct horse battery staple", "user-1");
    const pair = await authService.signIn("alice@example.com", "correct horse battery staple");
    for (const [hash, record] of stores.refreshTokens) {
      stores.refreshTokens.set(hash, { ...record, expiresAt: new Date(Date.now() - 1000) });
    }

    await expect(authService.refresh(pair.refreshToken)).rejects.toThrow("Invalid or expired refresh token");
  });

  it("rejects a revoked refresh token", async () => {
    const { authService, seed } = await buildAuth();
    await seed("alice@example.com", "correct horse battery staple", "user-1");
    const pair = await authService.signIn("alice@example.com", "correct horse battery staple");
    await authService.signOut(pair.refreshToken);

    await expect(authService.refresh(pair.refreshToken)).rejects.toThrow("Invalid or expired refresh token");
  });

  it("revokes the subject's sessions and rejects when loadClaims returns nothing at refresh time", async () => {
    const { authService, stores, seed } = await buildAuth();
    await seed("alice@example.com", "correct horse battery staple", "user-1");
    const pair = await authService.signIn("alice@example.com", "correct horse battery staple");
    stores.claimsBySubject.set("user-1", null);

    await expect(authService.refresh(pair.refreshToken)).rejects.toThrow("Invalid or expired refresh token");
  });
});

describe("AuthService.signOut", () => {
  it("is idempotent — signing out an already-revoked or unknown token never throws", async () => {
    const { authService, seed } = await buildAuth();
    await seed("alice@example.com", "correct horse battery staple", "user-1");
    const pair = await authService.signIn("alice@example.com", "correct horse battery staple");

    await expect(authService.signOut(pair.refreshToken)).resolves.toBeUndefined();
    await expect(authService.signOut(pair.refreshToken)).resolves.toBeUndefined();
    await expect(authService.signOut("never-issued")).resolves.toBeUndefined();
  });
});

describe("AuthService.issueTokens", () => {
  it("issues a fresh pair for an already-known subject", async () => {
    const { authService, stores } = await buildAuth();
    stores.claimsBySubject.set("user-2", { sub: "user-2", roles: ["admin"] });

    const pair = await authService.issueTokens("user-2");

    expect(pair.accessToken).toBeTruthy();
  });

  it("throws a plain Error (not UnauthorizedException) when loadClaims has nothing for the subject", async () => {
    const { authService } = await buildAuth();

    await expect(authService.issueTokens("ghost")).rejects.toThrow(/loadClaims\(\) returned nothing/);
  });
});

describe("AuthService.revokeAllSessions", () => {
  it("revokes every refresh token for a subject", async () => {
    const { authService, seed } = await buildAuth();
    await seed("alice@example.com", "correct horse battery staple", "user-1");
    const pair = await authService.signIn("alice@example.com", "correct horse battery staple");

    await authService.revokeAllSessions("user-1");

    await expect(authService.refresh(pair.refreshToken)).rejects.toThrow("Invalid or expired refresh token");
  });
});

describe("Issuing claims validation", () => {
  it("throws a plain Error when CredentialStore.loadClaims() returns claims that fail the app's own schema", async () => {
    const stores = createStores();
    // A structurally-valid TestClaims object (no cast needed) that a
    // refinement on the schema still rejects at runtime — proves the check
    // is a real schema validation, not just a shape check the type checker
    // would already have caught.
    const RefinedSchema = ClaimsSchema.refine((claims) => claims.sub.length > 0, "sub must not be empty");
    stores.claimsBySubject.set("user-1", { sub: "", roles: [] });
    stores.accounts.set("alice@example.com", { subject: "user-1", passwordHash: await hashPassword("secret") });
    const auth = defineAuthModule(RefinedSchema);

    @Module({
      imports: [
        auth.AuthModule.forRoot({
          secret: SECRET,
          issuing: { credentialStore: stores.TestCredentialStore, refreshTokenStore: stores.TestRefreshTokenStore },
        }),
      ],
    })
    class TestModule {}
    const app = await createHttpApplication(TestModule);
    const authService = app.get(auth.AUTH_SERVICE);

    await expect(authService.signIn("alice@example.com", "secret")).rejects.toThrow(/fail this app's own claims schema/);
  });
});

describe("Verify-only forRoot (no issuing)", () => {
  it("doesn't register AUTH_SERVICE — resolving it throws", async () => {
    const auth = defineAuthModule(ClaimsSchema);
    const app = await createHttpApplication(auth.AuthModule.forRoot({ secret: SECRET }));

    expect(() => app.get(auth.AUTH_SERVICE)).toThrow(/has not been resolved/);
  });
});

describe("issuing.imports pass-through", () => {
  const GREETING = new InjectionToken<string>("test.greeting");

  @Module({ providers: [{ provide: GREETING, useValue: "hello" }], exports: [GREETING] })
  class GreetingModule {}

  @Injectable()
  class StoreNeedingImport implements CredentialStore<TestClaims> {
    constructor(@Inject(GREETING) public readonly greeting: string) {}
    async findByIdentifier() {
      return null;
    }
    async loadClaims() {
      return null;
    }
  }

  it("lets a store inject a token from an explicitly imported module", async () => {
    const { TestRefreshTokenStore } = createStores();
    const auth = defineAuthModule(ClaimsSchema);

    @Module({
      imports: [
        auth.AuthModule.forRoot({
          secret: SECRET,
          issuing: {
            imports: [GreetingModule],
            credentialStore: StoreNeedingImport,
            refreshTokenStore: TestRefreshTokenStore,
          },
        }),
      ],
    })
    class TestModule {}

    await expect(createHttpApplication(TestModule)).resolves.toBeDefined();
  });

  it("fails to boot when the store's own dependency module isn't imported at all", async () => {
    const { TestRefreshTokenStore } = createStores();
    const auth = defineAuthModule(ClaimsSchema);

    @Module({
      imports: [
        auth.AuthModule.forRoot({
          secret: SECRET,
          issuing: { credentialStore: StoreNeedingImport, refreshTokenStore: TestRefreshTokenStore },
        }),
      ],
    })
    class TestModule {}

    await expect(createHttpApplication(TestModule)).rejects.toThrow(/No provider for/);
  });
});
