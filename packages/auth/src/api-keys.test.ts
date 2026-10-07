import { HttpException, UnauthorizedException } from "@blixis-io/http";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApiKeyVerifier, generateApiKey, hashApiKeySecret, parseApiKey, type ApiKeyRecord, type ApiKeyStore } from "./api-keys.js";

const ClaimsSchema = z.object({ sub: z.string(), roles: z.array(z.string()) });

describe("generateApiKey, parseApiKey, hashApiKeySecret", () => {
  it("makes blx_<24 hex>_<43 base64url> keys that parse back, and stores only the hash of the secret", () => {
    const made = generateApiKey();

    expect(made.key).toMatch(/^blx_[0-9a-f]{24}_[A-Za-z0-9_-]{43}$/);
    const parsed = parseApiKey(made.key);
    expect(parsed?.id).toBe(made.id);
    expect(hashApiKeySecret(parsed?.secret ?? "")).toBe(made.secretHash);
    expect(made.secretHash).not.toContain(parsed?.secret ?? "?");
    expect(made.key).not.toContain(made.secretHash);
  });

  it("never makes the same key twice", () => {
    const keys = new Set(Array.from({ length: 500 }, () => generateApiKey().key));

    expect(keys.size).toBe(500);
  });

  it("accepts a secret that holds underscores and dashes", () => {
    const secret = "a_b-c".padEnd(43, "x");
    expect(parseApiKey(`blx_${"0".repeat(24)}_${secret}`)).toEqual({ id: "0".repeat(24), secret });
  });

  const id = "a".repeat(24);
  const secret = "s".repeat(43);
  it.each([
    ["", "empty"],
    ["blx", "prefix only"],
    [`blx_${id}`, "no secret"],
    [`blx_${id}_`, "empty secret"],
    [`xyz_${id}_${secret}`, "another prefix"],
    [`BLX_${id}_${secret}`, "uppercase prefix"],
    [`blx_${"a".repeat(23)}_${secret}`, "short id"],
    [`blx_${"a".repeat(25)}_${secret}`, "long id"],
    [`blx_${"A".repeat(24)}_${secret}`, "uppercase hex id"],
    [`blx_${"g".repeat(24)}_${secret}`, "id that is not hex"],
    [`blx_${id}_${"s".repeat(42)}`, "short secret"],
    [`blx_${id}_${"s".repeat(44)}`, "long secret"],
    [`blx_${id}_${"s".repeat(42)}!`, "secret with a bad character"],
    [`blx_${id}_${"s".repeat(42)}=`, "padded secret"],
    [` blx_${id}_${secret}`, "leading space"],
    [`blx_${id}_${secret} `, "trailing space"],
    [`blx_${id}_${secret}\n`, "trailing newline"],
    [`blx__${id}_${secret}`, "empty first part"],
    [`blx_${id}_${secret}_extra`, "extra part"],
    [`blx_${id}_${"s".repeat(10_000)}`, "ten thousand characters"],
    [`blx_${id}_${"ｓ".repeat(43)}`, "full-width letters"],
  ])("refuses %j (%s)", (text) => {
    expect(parseApiKey(text)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------

const NOW = new Date("2026-10-07T12:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

interface Fixture {
  key: string;
  finds: string[];
  touches: string[];
  clock: { now: Date };
  records: Map<string, ApiKeyRecord>;
  verify: (headers?: Record<string, string>, address?: string) => Promise<unknown>;
  verifier: ReturnType<typeof createApiKeyVerifier<z.infer<typeof ClaimsSchema>>>;
}

function fixture(
  overrides: Partial<ApiKeyRecord> = {},
  options: { cacheSeconds?: number; lastUsedIntervalSeconds?: number; store?: Partial<ApiKeyStore>; touch?: boolean; address?: string | undefined } = {},
): Fixture {
  const made = generateApiKey();
  const records = new Map<string, ApiKeyRecord>([
    [made.id, { id: made.id, secretHash: made.secretHash, claims: { sub: "service-1", roles: ["reader"] }, scopes: ["read"], ...overrides }],
  ]);
  const finds: string[] = [];
  const touches: string[] = [];
  const clock = { now: NOW };
  const store: ApiKeyStore = {
    async find(requested) {
      finds.push(requested);
      return records.get(requested);
    },
    ...(options.touch === false
      ? {}
      : {
          async touch(touched) {
            touches.push(touched);
          },
        }),
    ...options.store,
  };
  const verifier = createApiKeyVerifier<z.infer<typeof ClaimsSchema>>({
    store,
    options: { cacheSeconds: options.cacheSeconds, lastUsedIntervalSeconds: options.lastUsedIntervalSeconds },
    parseClaims: async (value) => {
      const parsed = await ClaimsSchema.safeParseAsync(value);
      return parsed.success ? { success: true, data: parsed.data } : { success: false };
    },
    now: () => clock.now,
    clientAddress: () => options.address,
  });
  return {
    key: made.key,
    finds,
    touches,
    clock,
    records,
    verifier,
    verify: (headers = { "x-api-key": made.key }) => verifier.verify(new Request("http://localhost/", { headers })),
  };
}

/** Runs `verify` and returns what it threw, so a test can say exactly what a caller would see. */
async function failure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the key to be refused");
}

describe("createApiKeyVerifier", () => {
  it("accepts a good key and returns its claims, scopes and id", async () => {
    const f = fixture();

    const verified = await f.verify();

    expect(verified).toMatchObject({ claims: { sub: "service-1", roles: ["reader"] }, scopes: ["read"] });
    expect(f.finds).toHaveLength(1);
  });

  it("answers every kind of bad key with the same 401, in the same words", async () => {
    const good = fixture();
    const wrongSecret = `${good.key.slice(0, -1)}${good.key.endsWith("A") ? "B" : "A"}`;
    const unknown = generateApiKey().key;
    const cases: Array<[string, Fixture, Record<string, string>]> = [
      ["no header", good, {}],
      ["empty header", good, { "x-api-key": "" }],
      ["malformed", good, { "x-api-key": "not-a-key" }],
      ["unknown id", good, { "x-api-key": unknown }],
      ["wrong secret", good, { "x-api-key": wrongSecret }],
    ];
    const revoked = fixture({ revokedAt: minutes(-1) });
    cases.push(["revoked", revoked, { "x-api-key": revoked.key }]);
    const expired = fixture({ expiresAt: minutes(-1) });
    cases.push(["expired", expired, { "x-api-key": expired.key }]);
    const elsewhere = fixture({ allowedCidrs: ["203.0.113.0/24"] }, { address: "198.51.100.1" });
    cases.push(["outside the allowed networks", elsewhere, { "x-api-key": elsewhere.key }]);
    const bad = fixture({ claims: { sub: 1 } });
    cases.push(["claims fail the schema", bad, { "x-api-key": bad.key }]);

    const seen = await Promise.all(cases.map(async ([, f, headers]) => failure(f.verify(headers))));

    for (const error of seen) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.status).toBe(401);
      expect(error.detail).toBe("Invalid API key");
      expect(error.headers).toEqual(seen[0]?.headers);
    }
  });

  it("does not ask the store about a key that is not even well formed", async () => {
    const f = fixture();

    await failure(f.verify({ "x-api-key": "blx_short_key" }));
    await failure(f.verify({ "x-api-key": `blx_${"a".repeat(24)}_${"s".repeat(10_000)}` }));

    expect(f.finds).toEqual([]);
  });

  it("refuses from the moment of revocation or expiry, not before", async () => {
    const revoking = fixture({ revokedAt: minutes(5) });
    const expiring = fixture({ expiresAt: minutes(5) });

    await expect(revoking.verify()).resolves.toBeDefined();
    await expect(expiring.verify()).resolves.toBeDefined();
    revoking.clock.now = minutes(5);
    expiring.clock.now = minutes(5);

    expect((await failure(revoking.verify())).status).toBe(401);
    expect((await failure(expiring.verify())).status).toBe(401);
  });

  it("treats null revocation and expiry as none", async () => {
    await expect(fixture({ revokedAt: null, expiresAt: null }).verify()).resolves.toBeDefined();
  });

  describe("allowedCidrs", () => {
    it("lets a key in from inside its networks, IPv4 or IPv6, and refuses from outside", async () => {
      const inside = fixture({ allowedCidrs: ["203.0.113.0/24", "2001:db8::/32"] }, { address: "203.0.113.200" });
      const insideV6 = fixture({ allowedCidrs: ["203.0.113.0/24", "2001:db8::/32"] }, { address: "2001:db8::7" });
      const outside = fixture({ allowedCidrs: ["203.0.113.0/24", "2001:db8::/32"] }, { address: "203.0.114.1" });

      await expect(inside.verify()).resolves.toBeDefined();
      await expect(insideV6.verify()).resolves.toBeDefined();
      expect((await failure(outside.verify())).status).toBe(401);
    });

    it("refuses when the client address cannot be known, instead of letting it through", async () => {
      const unknown = fixture({ allowedCidrs: ["0.0.0.0/0"] }, { address: undefined });

      expect((await failure(unknown.verify())).status).toBe(401);
    });

    it("means from anywhere when the list is empty, null or missing", async () => {
      for (const allowedCidrs of [[], null, undefined]) {
        await expect(fixture({ allowedCidrs }, { address: undefined }).verify()).resolves.toBeDefined();
      }
    });

    it("answers 503, not an allow and not a 401, for a malformed network that is already stored", async () => {
      const broken = fixture({ allowedCidrs: ["10.0.0.0/99"] }, { address: "10.0.0.1" });

      expect((await failure(broken.verify())).status).toBe(503);
    });
  });

  describe("when the store fails", () => {
    it("answers 503 and never lets the request through", async () => {
      const f = fixture({}, {
        store: {
          async find() {
            throw new Error("connection refused");
          },
        },
      });

      const error = await failure(f.verify());

      expect(error.status).toBe(503);
      expect(error.detail).not.toContain("connection refused");
    });
  });

  describe("cacheSeconds", () => {
    it("asks the store once inside the window, and again after it", async () => {
      const f = fixture({}, { cacheSeconds: 60 });

      await f.verify();
      await f.verify();
      expect(f.finds).toHaveLength(1);
      f.clock.now = minutes(2);
      await f.verify();

      expect(f.finds).toHaveLength(2);
    });

    it("is the longest a revocation takes to apply, and no longer", async () => {
      const f = fixture({}, { cacheSeconds: 60 });
      await f.verify();
      const [record] = [...f.records.values()];
      if (!record) {
        throw new Error("no record");
      }
      f.records.set(record.id, { ...record, revokedAt: NOW });

      await expect(f.verify()).resolves.toBeDefined(); // still the remembered record, inside the window
      f.clock.now = minutes(2);
      expect((await failure(f.verify())).status).toBe(401);
    });

    it("still compares the secret on every request: a wrong secret is refused from the cache too", async () => {
      const f = fixture({}, { cacheSeconds: 60 });
      await f.verify();
      const wrong = `${f.key.slice(0, -1)}${f.key.endsWith("A") ? "B" : "A"}`;

      expect((await failure(f.verify({ "x-api-key": wrong }))).status).toBe(401);
      expect(f.finds).toHaveLength(1);
    });

    it("does not remember a key that was not found", async () => {
      const f = fixture({}, { cacheSeconds: 60 });
      const unknown = generateApiKey().key;

      await failure(f.verify({ "x-api-key": unknown }));
      await failure(f.verify({ "x-api-key": unknown }));

      expect(f.finds).toHaveLength(2);
    });

    it("is off by default", async () => {
      const f = fixture();

      await f.verify();
      await f.verify();

      expect(f.finds).toHaveLength(2);
    });
  });

  describe("last used", () => {
    it("is recorded at most once per interval, per key", async () => {
      const f = fixture({}, { lastUsedIntervalSeconds: 300 });

      await f.verify();
      await f.verify();
      await f.verify();
      expect(f.touches).toHaveLength(1);
      f.clock.now = minutes(6);
      await f.verify();

      expect(f.touches).toHaveLength(2);
    });

    it("is not recorded for a refused key", async () => {
      const f = fixture({ revokedAt: minutes(-1) });

      await failure(f.verify());

      expect(f.touches).toEqual([]);
    });

    it("never fails or delays the request when recording fails", async () => {
      const touch = vi.fn<(id: string, at: Date) => Promise<void>>(async () => {
        throw new Error("read-only replica");
      });
      const f = fixture({}, { store: { touch } });

      await expect(f.verify()).resolves.toBeDefined();
      expect(touch).toHaveBeenCalledTimes(1);
    });

    it("is optional on the store", async () => {
      await expect(fixture({}, { touch: false }).verify()).resolves.toBeDefined();
    });
  });
});
