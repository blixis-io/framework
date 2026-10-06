import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable, type Class, type Token } from "@blixis-io/di";
import { UnauthorizedException } from "@blixis-io/http";
import { SignJWT, type JWTPayload } from "jose";
import type { ZodType } from "zod";
import { hashPassword, verifyPassword } from "./password.js";
import type { NormalizedAuthOptions } from "./module.js";

export interface CredentialStore<Claims> {
  /** Looks up an account by whatever identifier the app signs in with (email, username, ...). `null`/`undefined` = no such account. */
  findByIdentifier(identifier: string): Promise<{ subject: string; passwordHash: string } | null | undefined>;
  /**
   * The full claims to sign into the access token for `subject` — must
   * satisfy the app's own claims schema. `null`/`undefined` means the
   * account is gone or disabled, which fails closed the same as a wrong
   * password.
   */
  loadClaims(subject: string): Promise<Claims | null | undefined>;
}

export interface RefreshTokenRecord {
  subject: string;
  expiresAt: Date;
  rotatedAt?: Date | null | undefined;
  revokedAt?: Date | null | undefined;
  /**
   * The login this token belongs to: signing in starts a family, every rotation keeps it. Optional, and only used if
   * the store also implements `revokeFamily`; a record without one (or a store without that method) is revoked per subject.
   */
  familyId?: string | null | undefined;
}

/** What a store is asked to persist for a new refresh token (besides the hash). */
export interface NewRefreshToken {
  subject: string;
  expiresAt: Date;
  /** Store it with the token if you implement `revokeFamily`; ignoring it is fine. */
  familyId: string;
}

export interface RefreshTokenStore {
  create(tokenHash: string, record: NewRefreshToken): Promise<void>;
  find(tokenHash: string): Promise<RefreshTokenRecord | null | undefined>;
  /**
   * Atomically marks an active (not already rotated or revoked) token as
   * rotated, resolving `true`. Resolves `false` without changing anything
   * if it was already rotated or revoked by the time this runs — the
   * signal `AuthService.refresh()` uses to detect two concurrent refreshes
   * of the same token racing each other, treated the same as reuse.
   */
  markRotated(tokenHash: string): Promise<boolean>;
  /**
   * Optional, and the way to make rotation safe against a failure part-way: marks `oldTokenHash` rotated **and** stores
   * the successor in one atomic step (a transaction), resolving `true`; resolves `false`, having changed nothing, if the
   * old token was already rotated or revoked. When this is implemented `refresh()` calls it instead of `create` +
   * `markRotated`. Without it `refresh()` stores the successor first and marks the old token rotated second, so a failure
   * leaves the client's old token usable (and at worst an unused successor), never a client with no valid token.
   */
  rotate?(oldTokenHash: string, next: NewRefreshToken & { tokenHash: string }): Promise<boolean>;
  /** Must be safe to call on an unknown or already-revoked hash — `AuthService.signOut()` relies on this being a no-op, not a throw. */
  revoke(tokenHash: string): Promise<void>;
  revokeAllForSubject(subject: string): Promise<void>;
  /** Optional. Revokes every refresh token of one login, so reusing a stolen token ends that session without signing out the user's other devices. */
  revokeFamily?(familyId: string): Promise<void>;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}

export interface AuthService {
  /** Throws `UnauthorizedException` with one generic message for an unknown identifier, wrong password, or a disabled account (`loadClaims` returning null) — never reveals which. */
  signIn(identifier: string, password: string): Promise<TokenPair>;
  /**
   * Rotates `refreshToken` for a new pair. Throws `UnauthorizedException`
   * if it's unknown, expired, revoked, or **already rotated**. Reuse of an
   * already-rotated token revokes that login's refresh tokens (its family
   * when the store supports one, else every refresh token of the subject),
   * since only the rightful client should ever hold the newest one, unless
   * it was rotated within `refreshReuseGraceSeconds`, which is a plain
   * rejection that revokes nothing.
   */
  refresh(refreshToken: string): Promise<TokenPair>;
  /** Revokes one refresh token. Idempotent — never throws for an unknown or already-revoked token. */
  signOut(refreshToken: string): Promise<void>;
  /** Issues a fresh pair for a subject that's already been authenticated some other way (e.g. right after sign-up). */
  issueTokens(subject: string): Promise<TokenPair>;
  /** Revokes every refresh token for `subject` — for a password change or disabling an account. */
  revokeAllSessions(subject: string): Promise<void>;
}

export interface NormalizedIssuingOptions {
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  refreshReuseGraceSeconds: number;
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Computed once, lazily, and reused for every signIn() against an unknown
// identifier — a valid-looking PHC string to verify against so an unknown
// account costs the same one Argon2id verification as a real one, instead
// of returning early and leaking "this identifier doesn't exist" via timing.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString("hex"));
  return dummyHash;
}

/** A freshly minted pair and what to persist for its refresh token. */
interface IssuedTokens {
  pair: TokenPair;
  refreshTokenHash: string;
  record: NewRefreshToken;
}

interface AuthServiceTokens<Claims> {
  // Typed as the bare `ZodType`, not `ZodType<Claims>` — the concrete
  // `Schema extends ZodType` generic parameter callers actually have
  // doesn't structurally satisfy `ZodType<Claims>` under
  // `exactOptionalPropertyTypes`, even though `Claims` is defined as
  // `z.infer<Schema>` at every call site. `.safeParse()`'s result is
  // narrowed with `as JWTPayload` right where it's used below regardless,
  // so nothing downstream actually needs the precise type here.
  claimsSchema: ZodType;
  authOptionsToken: Token<NormalizedAuthOptions>;
  issuingOptionsToken: Token<NormalizedIssuingOptions>;
  credentialStoreToken: Token<CredentialStore<Claims>>;
  refreshTokenStoreToken: Token<RefreshTokenStore>;
}

/**
 * Builds the `AuthService` implementation, bound to one
 * `defineAuthModule()` call's tokens — kept out of `module.ts` to keep that
 * file readable. `deps` are all closure-captured `@Inject` targets, same
 * trick `createRolesGuard` already uses for its own per-call guard class.
 * `Claims` only matters internally, for wiring the right `CredentialStore`
 * and validating claims before signing — `AuthService`'s own methods never
 * hand a caller a `Claims` value (they only ever return opaque tokens), so
 * it stays a plain, non-generic interface rather than a phantom parameter.
 */
export function createAuthServiceClass<Claims>(deps: AuthServiceTokens<Claims>): Class<AuthService> {
  @Injectable()
  class AuthServiceImpl implements AuthService {
    constructor(
      @Inject(deps.authOptionsToken) private readonly authOptions: NormalizedAuthOptions,
      @Inject(deps.issuingOptionsToken) private readonly issuingOptions: NormalizedIssuingOptions,
      @Inject(deps.credentialStoreToken) private readonly credentials: CredentialStore<Claims>,
      @Inject(deps.refreshTokenStoreToken) private readonly refreshTokens: RefreshTokenStore,
    ) {}

    async signIn(identifier: string, password: string): Promise<TokenPair> {
      const record = await this.credentials.findByIdentifier(identifier);
      const passwordHash = record?.passwordHash ?? (await getDummyHash());
      const valid = await verifyPassword(password, passwordHash);

      if (!record || !valid) {
        throw new UnauthorizedException("Invalid credentials");
      }

      const claims = await this.credentials.loadClaims(record.subject);
      if (!claims) {
        throw new UnauthorizedException("Invalid credentials");
      }

      return this.#startSession(record.subject, claims);
    }

    async refresh(refreshToken: string): Promise<TokenPair> {
      const tokenHash = hashRefreshToken(refreshToken);
      const record = await this.refreshTokens.find(tokenHash);

      if (!record || record.revokedAt || record.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedException("Invalid or expired refresh token");
      }

      if (record.rotatedAt) {
        // A token that was just rotated and is shown again is, most likely, the client refreshing twice at once (two
        // tabs, a retry after a timeout). Inside the grace window that is a plain rejection: the client still holds the
        // newer token from the first response. Outside it, it is reuse, and the session is revoked.
        if (!this.#withinGrace(record.rotatedAt.getTime())) {
          await this.#revokeSession(record);
        }
        throw new UnauthorizedException("Invalid or expired refresh token");
      }

      // Everything that can fail without leaving a trace happens before anything is written: a failure here costs the
      // client nothing, it retries with the token it still has.
      const claims = await this.credentials.loadClaims(record.subject);
      if (!claims) {
        await this.refreshTokens.revokeAllForSubject(record.subject);
        throw new UnauthorizedException("Invalid or expired refresh token");
      }
      const issued = await this.#build(record.subject, claims, record.familyId ?? randomUUID());

      const rotated = await this.#rotate(tokenHash, issued);
      if (!rotated) {
        // Lost a race with a concurrent refresh of this exact token: it was rotated a moment ago, so the same handling
        // as the rotated-token case above.
        if (!this.#withinGrace(Date.now())) {
          await this.#revokeSession(record);
        }
        throw new UnauthorizedException("Invalid or expired refresh token");
      }
      return issued.pair;
    }

    async signOut(refreshToken: string): Promise<void> {
      await this.refreshTokens.revoke(hashRefreshToken(refreshToken));
    }

    async issueTokens(subject: string): Promise<TokenPair> {
      const claims = await this.credentials.loadClaims(subject);
      if (!claims) {
        throw new Error(
          `issueTokens() was called for subject "${subject}", but loadClaims() returned nothing for it — the caller must ensure the account exists (and is visible to loadClaims) before calling this.`,
        );
      }
      return this.#startSession(subject, claims);
    }

    async revokeAllSessions(subject: string): Promise<void> {
      await this.refreshTokens.revokeAllForSubject(subject);
    }

    #withinGrace(rotatedAtMs: number): boolean {
      const graceMs = this.issuingOptions.refreshReuseGraceSeconds * 1000;
      return graceMs > 0 && Date.now() - rotatedAtMs <= graceMs;
    }

    /** Ends the login a reused token belongs to: its family if the store keeps one, else every refresh token of the subject. */
    async #revokeSession(record: RefreshTokenRecord): Promise<void> {
      if (record.familyId && this.refreshTokens.revokeFamily) {
        await this.refreshTokens.revokeFamily(record.familyId);
        return;
      }
      await this.refreshTokens.revokeAllForSubject(record.subject);
    }

    /** Stores the successor and marks the old token rotated: atomically if the store can, else successor first so a failure never strands the client. */
    async #rotate(oldTokenHash: string, issued: IssuedTokens): Promise<boolean> {
      const next = { tokenHash: issued.refreshTokenHash, ...issued.record };
      if (this.refreshTokens.rotate) {
        return this.refreshTokens.rotate(oldTokenHash, next);
      }
      await this.refreshTokens.create(next.tokenHash, issued.record);
      const marked = await this.refreshTokens.markRotated(oldTokenHash);
      if (!marked) {
        // The successor was never handed to anyone; don't leave a live token behind for it.
        await this.refreshTokens.revoke(next.tokenHash).catch(() => {});
      }
      return marked;
    }

    async #startSession(subject: string, claims: Claims): Promise<TokenPair> {
      const issued = await this.#build(subject, claims, randomUUID());
      await this.refreshTokens.create(issued.refreshTokenHash, issued.record);
      return issued.pair;
    }

    /** Signs the access token and mints the refresh token, persisting nothing. */
    async #build(subject: string, claims: Claims, familyId: string): Promise<IssuedTokens> {
      const parsedClaims = deps.claimsSchema.safeParse(claims);
      if (!parsedClaims.success) {
        throw new Error(
          `CredentialStore.loadClaims("${subject}") returned claims that fail this app's own claims schema — the guard that later verifies this token would reject it too: ${parsedClaims.error.message}`,
        );
      }

      const now = Date.now();
      const accessTokenExpiresAt = new Date(now + this.issuingOptions.accessTokenTtlSeconds * 1000);
      // The claims shape is fully app-defined (any object satisfying the
      // app's own Zod schema) — jose's JWTPayload type can't express that
      // structurally, so this is the one place that trusts the schema just
      // validated it, same category of boundary cast as @blixis-io/events'
      // `payload as never`.
      const jwt = new SignJWT(parsedClaims.data as JWTPayload)
        .setProtectedHeader({ alg: this.authOptions.algorithm })
        .setIssuedAt()
        .setExpirationTime(Math.floor(accessTokenExpiresAt.getTime() / 1000));
      // The same values the guard checks, so a token this service issues is one this app's guard accepts.
      if (this.authOptions.issuer !== undefined) {
        jwt.setIssuer(this.authOptions.issuer);
      }
      if (this.authOptions.audience !== undefined) {
        jwt.setAudience(typeof this.authOptions.audience === "string" ? this.authOptions.audience : [...this.authOptions.audience]);
      }
      const accessToken = await jwt.sign(this.authOptions.key);

      const refreshToken = randomBytes(32).toString("base64url");
      const refreshTokenExpiresAt = new Date(now + this.issuingOptions.refreshTokenTtlSeconds * 1000);

      return {
        pair: { accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt },
        refreshTokenHash: hashRefreshToken(refreshToken),
        record: { subject, expiresAt: refreshTokenExpiresAt, familyId },
      };
    }
  }

  return AuthServiceImpl;
}
