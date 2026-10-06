import { argon2Sync } from "node:crypto";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assertWithinLimits, hashPassword, verifyPassword, type StoredHashParameters } from "./password.js";

/**
 * A stored hash is data the application does not control (a database column, an import): `verifyPassword` parses it and
 * does what it says. These properties check the parser agrees with Node's own Argon2 on any small parameters, that
 * anything that is not a hash is refused with a clear error instead of being computed, and that the limits hold at
 * their edges for every parameter, with nothing expensive ever run to find that out.
 */

const phc = (memory: number, passes: number, parallelism: number, salt: Buffer, tag: Buffer): string =>
  `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${salt.toString("base64url")}$${tag.toString("base64url")}`;

/** Parameters small enough to compute in a millisecond or two, and valid for Argon2 (memory at least 8 per lane). */
const cheap = fc.record({
  parallelism: fc.integer({ min: 1, max: 2 }),
  passes: fc.integer({ min: 1, max: 2 }),
  memoryPerLane: fc.integer({ min: 8, max: 32 }),
  tagLength: fc.integer({ min: 4, max: 32 }),
  salt: fc.uint8Array({ minLength: 8, maxLength: 24 }).map((bytes) => Buffer.from(bytes)),
});

const refused = /Unrecognized password hash format|outside what this package will verify/;

describe("verifyPassword against Node's own Argon2", () => {
  it("accepts the right password and refuses a different one, for any small parameters and salt", async () => {
    await fc.assert(
      fc.asyncProperty(cheap, fc.string({ maxLength: 30 }), fc.string({ maxLength: 30 }), async ({ parallelism, passes, memoryPerLane, tagLength, salt }, password, other) => {
        const memory = memoryPerLane * parallelism;
        const tag = argon2Sync("argon2id", { message: password, nonce: salt, parallelism, tagLength, memory, passes });
        const stored = phc(memory, passes, parallelism, salt, tag);

        expect(await verifyPassword(password, stored)).toBe(true);
        expect(await verifyPassword(other, stored)).toBe(other === password);
      }),
      { numRuns: 60 },
    );
  });

  it("round-trips what hashPassword produces", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 40 }), async (password) => {
        const hash = await hashPassword(password);

        expect(hash).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
        expect(await verifyPassword(password, hash)).toBe(true);
      }),
      { numRuns: 8 },
    );
  });
});

describe("verifyPassword refuses what is not a hash", () => {
  it("rejects any string that is not shaped like a PHC argon2id hash, naming the problem, without computing anything", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 60 }).filter((text) => !text.startsWith("$argon2id$v=19$m=")), async (text) => {
        await expect(verifyPassword("password", text)).rejects.toThrow(refused);
      }),
      { numRuns: 500 },
    );
  });

  it("never verifies a damaged hash: a hash cut short is refused with the documented error, or (cut inside the tag, leaving a shorter one) simply does not match", async () => {
    const valid = phc(16, 1, 1, Buffer.from("saltsalt"), Buffer.from("tagtag12"));

    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: valid.length - 1 }), async (cut) => {
        const outcome = await verifyPassword("password", valid.slice(0, cut)).then(
          (verified) => String(verified),
          (error: unknown) => String(error),
        );

        expect(outcome).toMatch(/^false$|Unrecognized password hash format|outside what this package will verify/);
      }),
      { numRuns: valid.length },
    );
  });

  it("rejects extra segments and other versions or algorithms", async () => {
    const valid = phc(16, 1, 1, Buffer.from("saltsalt"), Buffer.from("tagtag12"));

    for (const damaged of [`${valid}$extra`, valid.replace("argon2id", "argon2i"), valid.replace("v=19", "v=16"), valid.replace("$argon2id$", () => "$argon2id$$")]) {
      await expect(verifyPassword("password", damaged)).rejects.toThrow(refused);
    }
  });
});

const within = ({ memory, passes, parallelism, tagLength }: StoredHashParameters): boolean =>
  memory <= 1_048_576 && passes <= 20 && parallelism <= 16 && tagLength >= 4 && tagLength <= 256;

describe("the limits on what a stored hash may ask for", () => {
  const parameters = fc.record({
    memory: fc.integer({ min: 0, max: 2_000_000 }),
    passes: fc.integer({ min: 0, max: 40 }),
    parallelism: fc.integer({ min: 0, max: 32 }),
    tagLength: fc.integer({ min: 0, max: 400 }),
  });

  it("allows exactly the parameters inside the documented limits and refuses every other combination", () => {
    fc.assert(
      fc.property(parameters, (candidate) => {
        const outcome = (() => {
          try {
            assertWithinLimits(candidate);
            return "allowed";
          } catch (error) {
            return String(error);
          }
        })();

        expect(outcome).toMatch(within(candidate) ? /^allowed$/ : /outside what this package will verify/);
      }),
      { numRuns: 4000 },
    );
  });

  it("refuses a hash that asks for more than the limits before any work is done, however the rest of it looks", async () => {
    const tooBig = fc.oneof(
      fc.record({ memory: fc.integer({ min: 1_048_577, max: 2_000_000_000 }), passes: fc.constant(1), parallelism: fc.constant(1) }),
      fc.record({ memory: fc.constant(16), passes: fc.integer({ min: 21, max: 4_000_000_000 }), parallelism: fc.constant(1) }),
      fc.record({ memory: fc.constant(16), passes: fc.constant(1), parallelism: fc.integer({ min: 17, max: 1_000_000 }) }),
    );

    await fc.assert(
      fc.asyncProperty(tooBig, async ({ memory, passes, parallelism }) => {
        const started = performance.now();

        await expect(verifyPassword("password", phc(memory, passes, parallelism, Buffer.from("saltsalt"), Buffer.from("tagtag12")))).rejects.toThrow(/outside what this package will verify/);
        expect(performance.now() - started).toBeLessThan(250);
      }),
      { numRuns: 300 },
    );
  });
});
