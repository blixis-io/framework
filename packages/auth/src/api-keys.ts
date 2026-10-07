import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ModuleRef } from "@blixis-io/core";
import type { Class } from "@blixis-io/di";
import { HttpException, UnauthorizedException } from "@blixis-io/http";
import { createIpMatcher, getClientIp, type ClientIpOptions } from "@blixis-io/security";

/** The header an API key is read from. */
export const API_KEY_HEADER = "x-api-key";

const PREFIX = "blx";
const ID_PATTERN = /^[0-9a-f]{24}$/;
/** 32 random bytes in base64url, which is 43 characters. */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A key as handed to its owner, and the one part the server keeps. */
export interface GeneratedApiKey {
  /** What identifies the key in the store and in logs. Not secret. */
  id: string;
  /** The whole key, `blx_<id>_<secret>`. **Shown once**: only `secretHash` is stored. */
  key: string;
  /** Store this next to `id`. SHA-256 of the secret, base64url. */
  secretHash: string;
}

/**
 * Hashes a key's secret for storage and comparison. A plain SHA-256, not a slow password hash, on purpose: the secret is
 * 32 random bytes, so there is nothing to guess and nothing for a slow hash to protect, while a slow hash would cost every
 * authenticated request.
 */
export function hashApiKeySecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

/** Makes a new key: `blx_` + 24 hex characters of id + `_` + 43 characters of secret (256 bits from the system's CSPRNG). */
export function generateApiKey(): GeneratedApiKey {
  const id = randomBytes(12).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  return { id, key: `${PREFIX}_${id}_${secret}`, secretHash: hashApiKeySecret(secret) };
}

/**
 * Reads `blx_<id>_<secret>` exactly, or returns `undefined`. Strict about length and alphabet, so anything else (a typo, a
 * scanner's junk, a megabyte header) is refused **before** the store is asked, and cannot be used to hammer it.
 */
export function parseApiKey(text: string): { id: string; secret: string } | undefined {
  const parts = text.split("_");
  // The secret is base64url and may itself contain `_`, so everything after the second separator is the secret.
  const [prefix, id, ...rest] = parts;
  const secret = rest.join("_");
  if (prefix !== PREFIX || id === undefined || !ID_PATTERN.test(id) || !SECRET_PATTERN.test(secret)) {
    return undefined;
  }
  return { id, secret };
}

/** What the store keeps for one key. */
export interface ApiKeyRecord {
  id: string;
  /** `hashApiKeySecret(secret)` of the secret that was issued. */
  secretHash: string;
  /**
   * Who the key acts as, as stored (a JSON column, say). It is **validated by the same claims schema as a token's
   * payload** when the key is used, so roles and tenancy work unchanged and a row that no longer fits is refused.
   */
  claims: unknown;
  /** What the key may do, for `RequireScopes`-style checks. Empty or missing: no scope-limited routes. */
  scopes?: readonly string[] | undefined;
  /** After this moment the key is refused. */
  expiresAt?: Date | null | undefined;
  /** From this moment the key is refused. Revoking is setting it; the row stays for the audit trail. */
  revokedAt?: Date | null | undefined;
  /**
   * Networks the key may be used from (`"203.0.113.0/24"`, `"2001:db8::/32"`, or a single address). A request from
   * anywhere else is refused. **Empty or missing means from anywhere**; an *unknown* client address is refused when this
   * is set. Only as trustworthy as `getClientIp`: see `apiKeys.clientIp`.
   */
  allowedCidrs?: readonly string[] | null | undefined;
}

/** The application's own storage for keys: a DI class, so it can inject `DATABASE` or anything else. */
export interface ApiKeyStore {
  /** The key with this id, or `undefined`. Throwing means "cannot tell": the request is answered `503`, never allowed. */
  find(id: string): Promise<ApiKeyRecord | undefined>;
  /** Optional, best effort: remember when a key was last used. Called at most once per `lastUsedIntervalSeconds` per key and process; a failure is ignored. */
  touch?(id: string, at: Date): Promise<void>;
}

export interface ApiKeyOptions {
  /** The app's own store implementation. */
  store: Class<ApiKeyStore>;
  /** Modules to import so the store can see what it injects (as `issuing.imports`). */
  imports?: ModuleRef[] | undefined;
  /**
   * How the client address is decided for `allowedCidrs`: the same options as `getClientIp`. **Without
   * `trustedProxyHops` behind a proxy, every client looks like the proxy**; with it set wrongly (or the server reachable
   * around the proxy), a client can choose its address. Read `getClientIp`'s documentation before relying on this.
   */
  clientIp?: ClientIpOptions | undefined;
  /**
   * Seconds a found record is remembered in this process, so a hot key does not cost a query per request. Default `0`
   * (off). **It is also the longest a revocation, an expiry change or new CIDRs can take to apply** to a process that
   * has the old record. The secret is still compared on every request; only the record is cached.
   */
  cacheSeconds?: number | undefined;
  /**
   * When `true`, a key is refused (403) on any route that does not carry `@RequireScopes(...)`, so a key can only reach
   * routes that say what they need. Default `false`. Turn it on: without it, a key that holds only `read` still reaches
   * every route someone forgot to annotate.
   */
  scopedRoutesOnly?: boolean | undefined;
  /** At most one `touch` per key and process in this many seconds. Default 300. */
  lastUsedIntervalSeconds?: number | undefined;
}

export interface VerifiedApiKey<Claims> {
  id: string;
  claims: Claims;
  scopes: readonly string[];
}

export interface ApiKeyVerifier<Claims> {
  /** `ApiKeyOptions.scopedRoutesOnly`, so the guard can apply it. */
  readonly scopedRoutesOnly: boolean;
  /** Reads the key from the request and checks it. Throws `UnauthorizedException` (one message for every failure) or a 503. */
  verify(request: Request): Promise<VerifiedApiKey<Claims>>;
}

const INVALID = "Invalid API key";
const MAX_REMEMBERED = 10_000;

/** A hash nothing can match, compared against for an unknown id so that it costs about what a wrong secret costs. */
const DUMMY_HASH = hashApiKeySecret("no key has this secret");

function sameHash(given: string, stored: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(stored);
  // `timingSafeEqual` throws on different lengths; a stored hash of another length simply never matches, after the same work.
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface VerifierDependencies<Claims> {
  store: ApiKeyStore;
  options: Omit<ApiKeyOptions, "store" | "imports">;
  /** The claims schema's `safeParseAsync`, so a key's claims are held to the same rules as a token's. */
  parseClaims: (value: unknown) => Promise<{ success: true; data: Claims } | { success: false }>;
  /** For tests. */
  now?: () => Date;
  /** For tests: decides the client address instead of `getClientIp`. */
  clientAddress?: (request: Request) => string | undefined;
}

/**
 * Checks `x-api-key` against the store. Every way of failing (a malformed key, an unknown id, a wrong secret, a revoked
 * or expired key, an address outside `allowedCidrs`, claims that fail the schema) is the **same** `401` with the same
 * words, so a response never says which part was wrong. A store that throws is a `503`: when the answer cannot be
 * known, the answer is no.
 */
export function createApiKeyVerifier<Claims>({ store, options, parseClaims, now = () => new Date(), clientAddress = (request) => getClientIp(request, options.clientIp) }: VerifierDependencies<Claims>): ApiKeyVerifier<Claims> {
  const cacheMs = (options.cacheSeconds ?? 0) * 1000;
  const touchMs = (options.lastUsedIntervalSeconds ?? 300) * 1000;
  const cache = new Map<string, { record: ApiKeyRecord; until: number }>();
  const touched = new Map<string, number>();
  const matchers = new Map<string, (ip: string | undefined) => boolean>();

  function matcherFor(record: ApiKeyRecord): (ip: string | undefined) => boolean {
    const networks = record.allowedCidrs ?? [];
    const cacheKey = networks.join(",");
    let matcher = matchers.get(cacheKey);
    if (!matcher) {
      // A malformed network in a stored record throws here, and is answered like a store failure: not guessed at.
      matcher = createIpMatcher(networks);
      if (matchers.size >= MAX_REMEMBERED) {
        matchers.clear();
      }
      matchers.set(cacheKey, matcher);
    }
    return matcher;
  }

  async function lookup(id: string): Promise<ApiKeyRecord | undefined> {
    const at = now().getTime();
    const remembered = cache.get(id);
    if (remembered && remembered.until > at) {
      return remembered.record;
    }
    let record: ApiKeyRecord | undefined;
    try {
      record = await store.find(id);
    } catch {
      throw new HttpException(503, "Service Unavailable");
    }
    if (record && cacheMs > 0) {
      if (cache.size >= MAX_REMEMBERED) {
        cache.clear();
      }
      cache.set(id, { record, until: at + cacheMs });
    }
    return record;
  }

  function remember(id: string): void {
    if (!store.touch) {
      return;
    }
    const at = now();
    const last = touched.get(id);
    if (last !== undefined && at.getTime() - last < touchMs) {
      return;
    }
    if (touched.size >= MAX_REMEMBERED) {
      touched.clear();
    }
    touched.set(id, at.getTime());
    // Best effort: a failing write never fails, or even delays, the request.
    void store.touch(id, at).catch(() => {});
  }

  return {
    scopedRoutesOnly: options.scopedRoutesOnly === true,
    async verify(request) {
      const parsed = parseApiKey(request.headers.get(API_KEY_HEADER) ?? "");
      if (!parsed) {
        throw new UnauthorizedException(INVALID);
      }
      const record = await lookup(parsed.id);
      // Compared whether or not the key exists, so an unknown id costs the same as a wrong secret.
      const matches = sameHash(hashApiKeySecret(parsed.secret), record?.secretHash ?? DUMMY_HASH);
      if (!record || !matches) {
        throw new UnauthorizedException(INVALID);
      }

      const at = now();
      if ((record.revokedAt && record.revokedAt <= at) || (record.expiresAt && record.expiresAt <= at)) {
        throw new UnauthorizedException(INVALID);
      }
      if ((record.allowedCidrs?.length ?? 0) > 0) {
        let inside: boolean;
        try {
          inside = matcherFor(record)(clientAddress(request));
        } catch {
          throw new HttpException(503, "Service Unavailable");
        }
        if (!inside) {
          throw new UnauthorizedException(INVALID);
        }
      }

      const claims = await parseClaims(record.claims);
      if (!claims.success) {
        throw new UnauthorizedException(INVALID);
      }
      remember(record.id);
      return { id: record.id, claims: claims.data, scopes: record.scopes ?? [] };
    },
  };
}
