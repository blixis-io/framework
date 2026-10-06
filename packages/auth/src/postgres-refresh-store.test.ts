import { Module } from "@blixis-io/core";
import { Injectable } from "@blixis-io/di";
import { createHttpApplication } from "@blixis-io/http";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { CredentialStore } from "./issuing.js";
import { defineAuthModule } from "./module.js";
import { hashPassword } from "./password.js";
import { PG_POOL, PostgresRefreshTokenStore } from "./postgres-refresh-store.example.js";

/** The reference Postgres store from the docs, run through the real `AuthService` against a real database. */

const CONNECTION = "postgres://blixis:blixis@localhost:5434/blixis";
const PASSWORD = "correct horse battery staple";
const ClaimsSchema = z.object({ sub: z.string(), roles: z.array(z.string()) });

const pool = new Pool({ connectionString: CONNECTION });

@Injectable()
class Credentials implements CredentialStore<z.infer<typeof ClaimsSchema>> {
  async findByIdentifier(identifier: string) {
    return { subject: identifier, passwordHash: await passwordHash };
  }
  async loadClaims(subject: string) {
    return { sub: subject, roles: [] };
  }
}

const passwordHash = hashPassword(PASSWORD);

@Module({ providers: [{ provide: PG_POOL, useValue: pool }], exports: [PG_POOL] })
class PoolModule {}

async function buildService(refreshReuseGraceSeconds?: number) {
  const auth = defineAuthModule(ClaimsSchema);

  @Module({
    imports: [
      auth.AuthModule.forRoot({
        secret: "test-secret-at-least-32-bytes-long!!",
        issuing: {
          imports: [PoolModule],
          credentialStore: Credentials,
          refreshTokenStore: PostgresRefreshTokenStore,
          ...(refreshReuseGraceSeconds === undefined ? {} : { refreshReuseGraceSeconds }),
        },
      }),
    ],
  })
  class TestModule {}

  const app = await createHttpApplication(TestModule);
  return { app, service: app.get(auth.AUTH_SERVICE) };
}

const rows = async () => (await pool.query<{ token_hash: string; rotated_at: Date | null; revoked_at: Date | null; family_id: string; subject: string }>("select * from refresh_tokens")).rows;
const live = async (subject: string) => (await rows()).filter((row) => row.subject === subject && !row.rotated_at && !row.revoked_at).length;

beforeAll(async () => {
  await pool.query("drop table if exists refresh_tokens");
  await pool.query(`create table refresh_tokens (
    token_hash text primary key,
    subject text not null,
    family_id uuid not null,
    expires_at timestamptz not null,
    rotated_at timestamptz,
    revoked_at timestamptz
  )`);
  await pool.query("create index refresh_tokens_subject on refresh_tokens (subject)");
  await pool.query("create index refresh_tokens_family on refresh_tokens (family_id)");
  // Lets a test make the insert of the successor fail for real, inside the rotation's transaction.
  await pool.query(`create or replace function refresh_tokens_fail() returns trigger language plpgsql as $$
    begin raise exception 'connection lost between the two writes'; end $$`);
});

beforeEach(async () => {
  await pool.query("drop trigger if exists fail_insert on refresh_tokens");
  await pool.query("delete from refresh_tokens");
});

afterAll(async () => {
  await pool.query("drop table if exists refresh_tokens");
  await pool.query("drop function if exists refresh_tokens_fail()");
  await pool.end();
});

describe("PostgresRefreshTokenStore through AuthService", () => {
  it("stores only a hash of the refresh token", async () => {
    const { app, service } = await buildService();

    const pair = await service.signIn("alice", PASSWORD);

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.token_hash).not.toContain(pair.refreshToken);
    expect(stored[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    await app.close();
  });

  it("rotates in one step: the old token is marked rotated and the successor stored, in the same family", async () => {
    const { app, service } = await buildService();
    const first = await service.signIn("alice", PASSWORD);

    const second = await service.refresh(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    const stored = await rows();
    expect(stored).toHaveLength(2);
    expect(new Set(stored.map((row) => row.family_id)).size).toBe(1);
    expect(stored.filter((row) => row.rotated_at)).toHaveLength(1);
    expect(await live("alice")).toBe(1);
    await app.close();
  });

  it("when the write of the successor fails, the old token is still valid and was not marked rotated", async () => {
    const { app, service } = await buildService();
    const first = await service.signIn("alice", PASSWORD);
    await pool.query("create trigger fail_insert before insert on refresh_tokens for each row execute function refresh_tokens_fail()");

    await expect(service.refresh(first.refreshToken)).rejects.toThrow("connection lost between the two writes");
    await pool.query("drop trigger fail_insert on refresh_tokens");

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.rotated_at).toBeNull();
    await expect(service.refresh(first.refreshToken)).resolves.toMatchObject({ refreshToken: expect.any(String) });
    await app.close();
  });

  it("lets exactly one of many simultaneous refreshes of one token win", async () => {
    const { app, service } = await buildService();
    const first = await service.signIn("alice", PASSWORD);

    const results = await Promise.allSettled(Array.from({ length: 12 }, () => service.refresh(first.refreshToken)));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(11);
    await app.close();
  });

  it("signs the login out when the race loser reaches the store, with the default of no grace", async () => {
    const { app, service } = await buildService();
    const first = await service.signIn("alice", PASSWORD);

    await Promise.allSettled([service.refresh(first.refreshToken), service.refresh(first.refreshToken)]);

    expect(await live("alice")).toBe(0);
    await app.close();
  });

  it("keeps the winner's session when a grace window is set, however many refreshes raced", async () => {
    const { app, service } = await buildService(10);
    const first = await service.signIn("alice", PASSWORD);

    const results = await Promise.allSettled(Array.from({ length: 6 }, () => service.refresh(first.refreshToken)));

    const winner = results.find((result) => result.status === "fulfilled");
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await live("alice")).toBe(1);
    const token = winner?.status === "fulfilled" ? winner.value.refreshToken : "";
    await expect(service.refresh(token)).resolves.toBeDefined();
    await app.close();
  });

  it("revokes the whole login when an old token is replayed, and nothing of the user's other logins", async () => {
    const { app, service } = await buildService();
    const phone = await service.signIn("alice", PASSWORD);
    const laptop = await service.signIn("alice", PASSWORD);
    const phoneNext = await service.refresh(phone.refreshToken);

    await expect(service.refresh(phone.refreshToken)).rejects.toThrow("Invalid or expired refresh token");

    await expect(service.refresh(phoneNext.refreshToken)).rejects.toThrow("Invalid or expired refresh token");
    await expect(service.refresh(laptop.refreshToken)).resolves.toBeDefined();
    await app.close();
  });

  it("keeps several devices independent: refreshing and signing out one does not touch the others", async () => {
    const { app, service } = await buildService();
    const devices = await Promise.all([service.signIn("alice", PASSWORD), service.signIn("alice", PASSWORD), service.signIn("alice", PASSWORD)]);

    const refreshed = await Promise.all(devices.map((device) => service.refresh(device.refreshToken)));
    await service.signOut(refreshed[0]?.refreshToken ?? "");

    await expect(service.refresh(refreshed[0]?.refreshToken ?? "")).rejects.toThrow("Invalid or expired refresh token");
    await expect(service.refresh(refreshed[1]?.refreshToken ?? "")).resolves.toBeDefined();
    await expect(service.refresh(refreshed[2]?.refreshToken ?? "")).resolves.toBeDefined();
    await app.close();
  });

  it("signs out one token idempotently, and an unknown token is a no-op", async () => {
    const { app, service } = await buildService();
    const pair = await service.signIn("alice", PASSWORD);

    await service.signOut(pair.refreshToken);
    await service.signOut(pair.refreshToken);
    await service.signOut("never-issued");

    await expect(service.refresh(pair.refreshToken)).rejects.toThrow("Invalid or expired refresh token");
    await app.close();
  });

  it("rejects an expired token", async () => {
    const { app, service } = await buildService();
    const pair = await service.signIn("alice", PASSWORD);
    await pool.query("update refresh_tokens set expires_at = now() - interval '1 second'");

    await expect(service.refresh(pair.refreshToken)).rejects.toThrow("Invalid or expired refresh token");
    await app.close();
  });

  it("ends every session of a subject on revokeAllSessions, and only that subject's", async () => {
    const { app, service } = await buildService();
    const alice1 = await service.signIn("alice", PASSWORD);
    const alice2 = await service.signIn("alice", PASSWORD);
    const bob = await service.signIn("bob", PASSWORD);

    await service.revokeAllSessions("alice");

    await expect(service.refresh(alice1.refreshToken)).rejects.toThrow("Invalid or expired refresh token");
    await expect(service.refresh(alice2.refreshToken)).rejects.toThrow("Invalid or expired refresh token");
    await expect(service.refresh(bob.refreshToken)).resolves.toBeDefined();
    await app.close();
  });
});
