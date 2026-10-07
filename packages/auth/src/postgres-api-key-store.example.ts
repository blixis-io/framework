import { Inject, Injectable } from "@blixis-io/di";
import { generateApiKey, type ApiKeyRecord, type ApiKeyStore } from "./api-keys.js";
import { PG_POOL, type PoolLike } from "./postgres-refresh-store.example.js";

/**
 * A reference `ApiKeyStore` for Postgres, the one the API key guide shows. It is not exported from the package
 * (`@blixis-io/auth` has no database dependency): copy it into your app. `api-keys.postgres.test` runs it against a real database.
 *
 * ```sql
 * create table api_keys (
 *   id text primary key,
 *   secret_hash text not null,          -- SHA-256 of the secret, never the secret or the key
 *   claims jsonb not null,              -- who the key acts as, validated by your claims schema when it is used
 *   scopes text[] not null default '{}',
 *   allowed_cidrs text[] not null default '{}',   -- empty means from anywhere
 *   expires_at timestamptz,
 *   revoked_at timestamptz,             -- revoking is setting this; the row stays for the audit trail
 *   created_at timestamptz not null default now(),
 *   last_used_at timestamptz
 * );
 * ```
 *
 * `create` and `revoke` are not part of `ApiKeyStore` (the guard only reads); they are here so a copy has the whole
 * lifecycle. `create` returns the key **once**, and only its hash is stored. Rotate by creating a second key for the
 * same client, moving the client to it, then revoking the first (two keys are valid in between). Delete rows long past
 * `revoked_at` or `expires_at` with a scheduled job, once you no longer need them for audit.
 */
interface Row {
  id: string;
  secret_hash: string;
  claims: unknown;
  scopes: string[];
  allowed_cidrs: string[];
  expires_at: Date | null;
  revoked_at: Date | null;
}

export interface NewApiKey {
  /** Whatever your claims schema accepts; stored as JSON. */
  claims: unknown;
  scopes?: readonly string[];
  allowedCidrs?: readonly string[];
  expiresAt?: Date | null;
}

@Injectable()
export class PostgresApiKeyStore implements ApiKeyStore {
  constructor(@Inject(PG_POOL) private readonly pool: PoolLike) {}

  async find(id: string): Promise<ApiKeyRecord | undefined> {
    const { rows } = await this.pool.query<Row>(
      "select id, secret_hash, claims, scopes, allowed_cidrs, expires_at, revoked_at from api_keys where id = $1",
      [id],
    );
    const row = rows[0];
    if (!row) {
      return undefined;
    }
    return {
      id: row.id,
      secretHash: row.secret_hash,
      // Not trusted yet: the guard validates it with your claims schema before using it.
      claims: row.claims,
      scopes: row.scopes,
      allowedCidrs: row.allowed_cidrs,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    };
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.pool.query("update api_keys set last_used_at = $2 where id = $1", [id, at]);
  }

  /** Makes a key and stores its hash. **The returned `key` is the only copy**: show it to its owner now. */
  async create(input: NewApiKey): Promise<{ id: string; key: string }> {
    const made = generateApiKey();
    await this.pool.query("insert into api_keys (id, secret_hash, claims, scopes, allowed_cidrs, expires_at) values ($1, $2, $3, $4, $5, $6)", [
      made.id,
      made.secretHash,
      JSON.stringify(input.claims),
      input.scopes ?? [],
      input.allowedCidrs ?? [],
      input.expiresAt ?? null,
    ]);
    return { id: made.id, key: made.key };
  }

  /** Refuses the key from now on. Idempotent: revoking twice keeps the first time. Returns whether a key was found. */
  async revoke(id: string): Promise<boolean> {
    const result = await this.pool.query("update api_keys set revoked_at = coalesce(revoked_at, now()) where id = $1", [id]);
    return result.rowCount === 1;
  }
}
