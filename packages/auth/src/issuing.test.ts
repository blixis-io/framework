import { Module } from "@blixis-io/core";
import { Inject, Injectable, InjectionToken } from "@blixis-io/di";
import { createHttpApplication, runInRequestContext } from "@blixis-io/http";
import { decodeJwt } from "jose";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AuthConfigError, defineAuthModule } from "./module.js";
import { hashPassword } from "./password.js";
import * as passwordModule from "./password.js";
import type { CredentialStore, NewRefreshToken, RefreshTokenRecord, RefreshTokenStore } from "./issuing.js";

/** The controller every hand-built ExecutionContext in this file points at. */
class TestController {}

const SECRET = "test-secret-at-least-32-bytes-long!!";
const ClaimsSchema = z.object({ sub: z.string(), roles: z.array(z.string()) });
type TestClaims = z.infer<typeof ClaimsSchema>;

interface Account {
  subject: string;
  passwordHash: string;
}

interface StoreFeatures {
  /** Implement the optional atomic `rotate()`. */
  rotate?: boolean;
  /** Implement the optional `revokeFamily()`. */
  revokeFamily?: boolean;
}

/** What a test can make fail on purpose, to see what a failure part-way leaves behind. */
interface Failures {
  create: boolean;
  markRotated: boolean;
  rotate: boolean;
  loadClaims: boolean;
}

/** Fresh, closure-captured in-memory stores per test — same "DbConnection-in-a-closure" trick every other package's own test fixtures use for a fresh DI provider per test. */
function createStores(features: StoreFeatures = {}) {
  const accounts = new Map<string, Account>();
  const claimsBySubject = new Map<string, TestClaims | null>();
  const refreshTokens = new Map<string, RefreshTokenRecord>();
  const failures: Failures = { create: false, markRotated: false, rotate: false, loadClaims: false };
  const calls: string[] = [];

  @Injectable()
  class TestCredentialStore implements CredentialStore<TestClaims> {
    async findByIdentifier(identifier: string) {
      return accounts.get(identifier) ?? null;
    }
    async loadClaims(subject: string) {
      if (failures.loadClaims) {
        throw new Error("database is down");
      }
      return claimsBySubject.get(subject) ?? null;
    }
  }

  @Injectable()
  class TestRefreshTokenStore implements RefreshTokenStore {
    // Added to the prototype below, only when a test asks for them: a store without them is the case being tested too.
    declare rotate?: NonNullable<RefreshTokenStore["rotate"]>;
    declare revokeFamily?: NonNullable<RefreshTokenStore["revokeFamily"]>;

    async create(tokenHash: string, record: NewRefreshToken) {
      calls.push("create");
      if (failures.create) {
        throw new Error("database is down");
      }
      refreshTokens.set(tokenHash, { subject: record.subject, expiresAt: record.expiresAt, familyId: record.familyId });
    }
    async find(tokenHash: string) {
      return refreshTokens.get(tokenHash) ?? null;
    }
    async markRotated(tokenHash: string) {
      calls.push("markRotated");
      if (failures.markRotated) {
        throw new Error("database is down");
      }
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
      calls.push("revokeAllForSubject");
      for (const [hash, record] of refreshTokens) {
        if (record.subject === subject) {
          refreshTokens.set(hash, { ...record, revokedAt: new Date() });
        }
      }
    }
  }

  if (features.rotate) {
    TestRefreshTokenStore.prototype.rotate = async function rotate(oldTokenHash: string, next: NewRefreshToken & { tokenHash: string }) {
      calls.push("rotate");
      if (failures.rotate) {
        throw new Error("database is down");
      }
      const old = refreshTokens.get(oldTokenHash);
      if (!old || old.rotatedAt || old.revokedAt) {
        return false;
      }
      refreshTokens.set(oldTokenHash, { ...old, rotatedAt: new Date() });
      refreshTokens.set(next.tokenHash, { subject: next.subject, expiresAt: next.expiresAt, familyId: next.familyId });
      return true;
    };
  }
  if (features.revokeFamily) {
    TestRefreshTokenStore.prototype.revokeFamily = async function revokeFamily(familyId: string) {
      calls.push("revokeFamily");
      for (const [hash, record] of refreshTokens) {
        if (record.familyId === familyId) {
          refreshTokens.set(hash, { ...record, revokedAt: new Date() });
        }
      }
    };
  }

  return { accounts, claimsBySubject, refreshTokens, failures, calls, TestCredentialStore, TestRefreshTokenStore };
}

interface BuildOptions extends StoreFeatures {
  refreshReuseGraceSeconds?: number;
}

async function buildAuth(claimsOverride?: TestClaims | null, options: BuildOptions = {}) {
  const stores = createStores(options);
  const auth = defineAuthModule(ClaimsSchema);

  @Module({
    imports: [
      auth.AuthModule.forRoot({
        secret: SECRET,
        issuing: {
          credentialStore: stores.TestCredentialStore,
          refreshTokenStore: stores.TestRefreshTokenStore,
          ...(options.refreshReuseGraceSeconds === undefined ? {} : { refreshReuseGraceSeconds: options.refreshReuseGraceSeconds }),
        },
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
      await expect(jwtGuard.canActivate({ request: requestWith(pair.accessToken), params: {}, controller: TestController, handler: "route" })).resolves.toBe(true);
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

async function buildScoped(options: { issuer?: string; audience?: string | string[] }) {
  const stores = createStores();
  const auth = defineAuthModule(ClaimsSchema);

  @Module({
    imports: [
      auth.AuthModule.forRoot({
        secret: SECRET,
        ...options,
        issuing: { credentialStore: stores.TestCredentialStore, refreshTokenStore: stores.TestRefreshTokenStore },
      }),
    ],
  })
  class ScopedModule {}

  const app = await createHttpApplication(ScopedModule);
  stores.accounts.set("a@example.com", { subject: "user-1", passwordHash: await hashPassword("pw-pw-pw-pw") });
  stores.claimsBySubject.set("user-1", { sub: "user-1", roles: [] });
  return { authService: app.get(auth.AUTH_SERVICE), jwtGuard: app.get(auth.JwtAuthGuard) };
}

describe("tokens issued with an issuer and audience configured", () => {
  it("signs the issuer and audience into the access token, and the same app's guard accepts it", async () => {
    const { authService, jwtGuard } = await buildScoped({ issuer: "https://auth.example.com", audience: "orders-api" });

    const pair = await authService.signIn("a@example.com", "pw-pw-pw-pw");

    const claims = decodeJwt(pair.accessToken);
    expect(claims.iss).toBe("https://auth.example.com");
    expect(claims.aud).toBe("orders-api");
    await runInRequestContext(async () => {
      await expect(jwtGuard.canActivate({ request: requestWith(pair.accessToken), params: {}, controller: TestController, handler: "route" })).resolves.toBe(true);
    });
  });

  it("signs several audiences as a list", async () => {
    const { authService } = await buildScoped({ audience: ["orders-api", "billing-api"] });

    const pair = await authService.signIn("a@example.com", "pw-pw-pw-pw");

    expect(decodeJwt(pair.accessToken).aud).toEqual(["orders-api", "billing-api"]);
    expect(decodeJwt(pair.accessToken).iss).toBeUndefined();
  });

  it("adds neither claim when none is configured", async () => {
    const { authService } = await buildScoped({});

    const claims = decodeJwt((await authService.signIn("a@example.com", "pw-pw-pw-pw")).accessToken);

    expect(claims.iss).toBeUndefined();
    expect(claims.aud).toBeUndefined();
  });
});

const PASSWORD = "correct horse battery staple";

async function signedIn(options: BuildOptions = {}) {
  const built = await buildAuth(undefined, options);
  await built.seed("alice@example.com", PASSWORD, "user-1");
  const first = await built.authService.signIn("alice@example.com", PASSWORD);
  return { ...built, first };
}

describe("AuthService.refresh: a failure part-way never strands the client", () => {
  it.each([
    ["loading the claims fails", (failures: Failures) => (failures.loadClaims = true)],
    ["storing the successor fails", (failures: Failures) => (failures.create = true)],
    ["marking the old token rotated fails", (failures: Failures) => (failures.markRotated = true)],
  ])("a store without rotate(): when %s, the old token still works on retry", async (_name, breakIt) => {
    const { authService, stores, first } = await signedIn();
    breakIt(stores.failures);

    await expect(authService.refresh(first.refreshToken)).rejects.toThrow("database is down");

    stores.failures.loadClaims = false;
    stores.failures.create = false;
    stores.failures.markRotated = false;
    await expect(authService.refresh(first.refreshToken)).resolves.toMatchObject({ refreshToken: expect.any(String) });
  });

  it("stores the successor before it marks the old token rotated, and never the other way round", async () => {
    const { authService, stores, first } = await signedIn();
    stores.calls.length = 0;

    await authService.refresh(first.refreshToken);

    expect(stores.calls).toEqual(["create", "markRotated"]);
  });

  it("a store without rotate(), after losing a race: no live successor is left behind for a token nobody received", async () => {
    const { authService, stores, first } = await signedIn();
    await authService.refresh(first.refreshToken); // first.refreshToken is now rotated

    const live = () => [...stores.refreshTokens.values()].filter((record) => !record.revokedAt && !record.rotatedAt).length;
    await expect(authService.refresh(first.refreshToken)).rejects.toThrow("Invalid or expired refresh token");

    expect(live()).toBe(0); // reuse revoked the whole subject, successor of the reuse attempt included
  });

  it("a store with rotate(): uses it, once, instead of create and markRotated", async () => {
    const { authService, stores, first } = await signedIn({ rotate: true });
    stores.calls.length = 0;

    const second = await authService.refresh(first.refreshToken);

    expect(stores.calls).toEqual(["rotate"]);
    await expect(authService.refresh(second.refreshToken)).resolves.toBeDefined();
  });

  it("a store with rotate(): when it fails nothing was written, so the old token works and there is no successor", async () => {
    const { authService, stores, first } = await signedIn({ rotate: true });
    const before = stores.refreshTokens.size;
    stores.failures.rotate = true;

    await expect(authService.refresh(first.refreshToken)).rejects.toThrow("database is down");

    expect(stores.refreshTokens.size).toBe(before);
    stores.failures.rotate = false;
    await expect(authService.refresh(first.refreshToken)).resolves.toBeDefined();
  });

  it("a store with rotate(): resolving false (it lost a race) is treated as reuse", async () => {
    const { authService, stores, first } = await signedIn({ rotate: true });
    const second = await authService.refresh(first.refreshToken);

    await expect(authService.refresh(first.refreshToken)).rejects.toThrow("Invalid or expired refresh token");
    await expect(authService.refresh(second.refreshToken)).rejects.toThrow("Invalid or expired refresh token");
    expect(stores.calls).toContain("revokeAllForSubject");
  });
});

describe("AuthService.refresh: one login at a time (families)", () => {
  it("reusing one device's old token ends that login only, and the user's other device keeps working", async () => {
    const { authService, seed } = await buildAuth(undefined, { revokeFamily: true });
    await seed("alice@example.com", PASSWORD, "user-1");
    const phone = await authService.signIn("alice@example.com", PASSWORD);
    const laptop = await authService.signIn("alice@example.com", PASSWORD);
    const phoneNext = await authService.refresh(phone.refreshToken);

    await expect(authService.refresh(phone.refreshToken)).rejects.toThrow("Invalid or expired refresh token"); // replayed

    await expect(authService.refresh(phoneNext.refreshToken)).rejects.toThrow("Invalid or expired refresh token"); // that login is over
    await expect(authService.refresh(laptop.refreshToken)).resolves.toBeDefined(); // the other one is not
  });

  it("keeps the family across rotations", async () => {
    const { authService, stores, first } = await signedIn({ revokeFamily: true });
    const second = await authService.refresh(first.refreshToken);
    await authService.refresh(second.refreshToken);

    const families = new Set([...stores.refreshTokens.values()].map((record) => record.familyId));

    expect(families.size).toBe(1);
    expect([...families][0]).toEqual(expect.any(String));
  });

  it("gives every sign-in its own family", async () => {
    const { authService, stores, seed } = await buildAuth(undefined, { revokeFamily: true });
    await seed("alice@example.com", PASSWORD, "user-1");
    await authService.signIn("alice@example.com", PASSWORD);
    await authService.signIn("alice@example.com", PASSWORD);

    expect(new Set([...stores.refreshTokens.values()].map((record) => record.familyId)).size).toBe(2);
  });

  it("falls back to revoking every session of the subject when the store has no revokeFamily()", async () => {
    const { authService, seed, stores } = await buildAuth();
    await seed("alice@example.com", PASSWORD, "user-1");
    const phone = await authService.signIn("alice@example.com", PASSWORD);
    const laptop = await authService.signIn("alice@example.com", PASSWORD);
    await authService.refresh(phone.refreshToken);

    await expect(authService.refresh(phone.refreshToken)).rejects.toThrow("Invalid or expired refresh token");

    expect(stores.calls).toContain("revokeAllForSubject");
    await expect(authService.refresh(laptop.refreshToken)).rejects.toThrow("Invalid or expired refresh token");
  });

  it("falls back to the subject for a token with no family (a row from before families)", async () => {
    const { authService, stores, first } = await signedIn({ revokeFamily: true });
    for (const [hash, record] of stores.refreshTokens) {
      stores.refreshTokens.set(hash, { subject: record.subject, expiresAt: record.expiresAt });
    }
    const second = await authService.refresh(first.refreshToken);
    stores.calls.length = 0;

    await expect(authService.refresh(first.refreshToken)).rejects.toThrow("Invalid or expired refresh token");

    expect(stores.calls).toEqual(["revokeAllForSubject"]);
    expect([...stores.refreshTokens.values()].find((record) => record.familyId)?.familyId).toEqual(expect.any(String)); // the successor started a family
    await expect(authService.refresh(second.refreshToken)).rejects.toThrow("Invalid or expired refresh token");
  });
});

describe("AuthService.refresh: refreshReuseGraceSeconds", () => {
  it("is off by default: refreshing an old token twice signs the login out", async () => {
    const { authService, first } = await signedIn();
    const second = await authService.refresh(first.refreshToken);

    await expect(authService.refresh(first.refreshToken)).rejects.toThrow("Invalid or expired refresh token");

    await expect(authService.refresh(second.refreshToken)).rejects.toThrow("Invalid or expired refresh token");
  });

  it("inside the window, the old token is refused but the session survives, and the newer token still works", async () => {
    const { authService, stores, first } = await signedIn({ refreshReuseGraceSeconds: 10 });
    const second = await authService.refresh(first.refreshToken);
    stores.calls.length = 0;

    await expect(authService.refresh(first.refreshToken)).rejects.toThrow("Invalid or expired refresh token");

    expect(stores.calls).not.toContain("revokeAllForSubject");
    await expect(authService.refresh(second.refreshToken)).resolves.toBeDefined();
  });

  it("outside the window, the same replay is reuse and revokes the session", async () => {
    const { authService, stores, first } = await signedIn({ refreshReuseGraceSeconds: 10 });
    const second = await authService.refresh(first.refreshToken);
    for (const [hash, record] of stores.refreshTokens) {
      if (record.rotatedAt) {
        stores.refreshTokens.set(hash, { ...record, rotatedAt: new Date(Date.now() - 11_000) });
      }
    }

    await expect(authService.refresh(first.refreshToken)).rejects.toThrow("Invalid or expired refresh token");

    await expect(authService.refresh(second.refreshToken)).rejects.toThrow("Invalid or expired refresh token");
  });

  it("two simultaneous refreshes of one token: one wins, and the winner's session survives the loser", async () => {
    const { authService, first } = await signedIn({ refreshReuseGraceSeconds: 10 });

    const results = await Promise.allSettled([authService.refresh(first.refreshToken), authService.refresh(first.refreshToken)]);

    const won = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof authService.refresh>>> => result.status === "fulfilled");
    expect(won).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(authService.refresh(won[0]?.value.refreshToken ?? "")).resolves.toBeDefined();
  });

  it("without it, the same race signs the winner out too (why the option exists)", async () => {
    const { authService, first } = await signedIn();

    const results = await Promise.allSettled([authService.refresh(first.refreshToken), authService.refresh(first.refreshToken)]);

    const winner = results.find((result) => result.status === "fulfilled");
    expect(winner).toBeDefined();
    const token = winner?.status === "fulfilled" ? winner.value.refreshToken : "";
    await expect(authService.refresh(token)).rejects.toThrow("Invalid or expired refresh token");
  });

  it.each([[-1], [Number.NaN], [Number.POSITIVE_INFINITY]])("refuses %s at boot", async (value) => {
    await expect(buildAuth(undefined, { refreshReuseGraceSeconds: value })).rejects.toThrow(AuthConfigError);
  });
});
