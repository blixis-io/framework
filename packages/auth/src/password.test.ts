import { argon2, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertWithinLimits, hashPassword, verifyPassword } from "./password.js";

/** Builds a PHC string with explicit, non-default params — proves verifyPassword reads params from the string itself. */
function phcHash(password: string, params: { memory: number; passes: number; parallelism: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    argon2("argon2id", { message: password, nonce: salt, tagLength: 32, ...params }, (error, tag) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(
        `$argon2id$v=19$m=${params.memory},t=${params.passes},p=${params.parallelism}$${salt.toString("base64url")}$${tag.toString("base64url")}`,
      );
    });
  });
}

describe("hashPassword / verifyPassword", () => {
  it("a hashed password verifies against the correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("produces a different hash for the same password each time (random salt)", async () => {
    const [first, second] = await Promise.all([hashPassword("same password"), hashPassword("same password")]);

    expect(first).not.toBe(second);
  });

  it("returns a self-describing PHC string", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[\w-]+\$[\w-]+$/);
  });

  it("verifies using the parameters stored in the hash, not the current module constants", async () => {
    const hash = await phcHash("low-cost password", { memory: 16, passes: 1, parallelism: 1 });

    await expect(verifyPassword("low-cost password", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("throws on a malformed hash instead of returning false", async () => {
    await expect(verifyPassword("anything", "not-a-real-hash")).rejects.toThrow(/Unrecognized password hash format/);
  });

  it("throws on a hash from a different, unsupported algorithm", async () => {
    await expect(verifyPassword("anything", "$scrypt$v=1$N=32768,r=8,p=1$c2FsdA$aGFzaA")).rejects.toThrow(
      /Unrecognized password hash format/,
    );
  });
});

describe("verifyPassword: limits on the parameters a stored hash may ask for", () => {
  const salt = randomBytes(16).toString("base64url");
  const tag = randomBytes(32).toString("base64url");
  const hashWith = (params: string, saltPart = salt, tagPart = tag) => `$argon2id$v=19$${params}$${saltPart}$${tagPart}`;

  it.each([
    ["4 GiB of memory", "m=4194304,t=2,p=1"],
    ["a memory figure too large to be a number", "m=99999999999999999999,t=2,p=1"],
    ["1000 passes", "m=19456,t=1000,p=1"],
    ["255 lanes", "m=19456,t=2,p=255"],
  ])("refuses a hash asking for %s, before doing any work", async (_label, params) => {
    await expect(verifyPassword("pw", hashWith(params))).rejects.toThrow("outside what this package will verify");
  });

  it.each([
    ["a 2-byte tag", randomBytes(2).toString("base64url")],
    ["a 1 KiB tag", randomBytes(1024).toString("base64url")],
  ])("refuses a hash with %s", async (_label, tagPart) => {
    await expect(verifyPassword("pw", hashWith("m=19456,t=2,p=1", salt, tagPart))).rejects.toThrow("outside what this package will verify");
  });

  it("names the parameters it refused, so a corrupted column is easy to find", async () => {
    await expect(verifyPassword("pw", hashWith("m=4194304,t=2,p=1"))).rejects.toThrow("m=4194304, t=2, p=1");
  });

  it("still verifies hashes made with the stronger settings other systems commonly use", async () => {
    const hash = await phcHash("correct horse", { memory: 65_536, passes: 3, parallelism: 4 });

    await expect(verifyPassword("correct horse", hash)).resolves.toBe(true);
  });

  it("accepts exactly the limits and refuses one past each of them", () => {
    const edge = { memory: 1_048_576, passes: 20, parallelism: 16, tagLength: 256 };

    expect(() => assertWithinLimits(edge)).not.toThrow();
    expect(() => assertWithinLimits({ ...edge, tagLength: 4 })).not.toThrow();
    expect(() => assertWithinLimits({ ...edge, memory: edge.memory + 1 })).toThrow("outside");
    expect(() => assertWithinLimits({ ...edge, passes: edge.passes + 1 })).toThrow("outside");
    expect(() => assertWithinLimits({ ...edge, parallelism: edge.parallelism + 1 })).toThrow("outside");
    expect(() => assertWithinLimits({ ...edge, tagLength: edge.tagLength + 1 })).toThrow("outside");
    expect(() => assertWithinLimits({ ...edge, tagLength: 3 })).toThrow("outside");
  });
});
