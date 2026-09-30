import { argon2, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

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
