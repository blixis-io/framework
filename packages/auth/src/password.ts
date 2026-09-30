import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

// OWASP-minimum Argon2id parameters (m=19456 KiB, t=2, p=1) — ~20ms per hash
// on typical hardware. Stored alongside the hash in the PHC string, so a
// future bump to these constants still verifies hashes minted under the old
// ones; verifyPassword always re-derives from what's actually stored, never
// from these constants directly.
const MEMORY_KIB = 19_456;
const PASSES = 2;
const PARALLELISM = 1;
const TAG_LENGTH = 32;
const SALT_LENGTH = 16;

interface Argon2idParams {
  nonce: Uint8Array;
  parallelism: number;
  tagLength: number;
  memory: number;
  passes: number;
}

function argon2id(password: string, params: Argon2idParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2("argon2id", { message: password, ...params }, (error, tag) => {
      // Every invalid-parameter case (bad memory/parallelism/tagLength)
      // throws synchronously from `argon2()` itself before this callback
      // ever runs — caught by this Promise's own executor, not here. The
      // `error` arm exists for a genuine internal crypto failure, which
      // isn't something a test can trigger deterministically.
      /* v8 ignore next 5 -- @preserve */
      if (error) {
        reject(error);
      } else {
        resolve(tag);
      }
    });
  });
}

/**
 * Hashes `password` with Argon2id, returning a self-describing PHC string
 * (`$argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>`, all base64url without
 * padding). Node's own `crypto.argon2` — no external dependency.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const tag = await argon2id(password, {
    nonce: salt,
    parallelism: PARALLELISM,
    tagLength: TAG_LENGTH,
    memory: MEMORY_KIB,
    passes: PASSES,
  });
  return `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$${salt.toString("base64url")}$${tag.toString("base64url")}`;
}

const PHC_PATTERN = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/;

// A successful PHC_PATTERN match always has all 5 capture groups present —
// `noUncheckedIndexedAccess` can't see that, so this makes it explicit
// instead of asserting past the type checker.
function requireGroup(match: RegExpExecArray, index: number): string {
  const value = match[index];
  // PHC_PATTERN has exactly 5 capture groups and only ever calls this with
  // index 1-5, so a successful match always has a defined value here — this
  // is unreachable through the public API, not a real "somehow still
  // undefined" case.
  /* v8 ignore start -- @preserve */
  if (value === undefined) {
    throw new Error(`Unrecognized password hash format: expected a $argon2id$... PHC string`);
  }
  /* v8 ignore stop */
  return value;
}

/**
 * Verifies `password` against a PHC string produced by `hashPassword`.
 * Re-derives the hash using the parameters and salt stored *in* `hash`, not
 * the current module constants, so a stored hash always verifies correctly
 * even after `MEMORY_KIB`/`PASSES` change. Throws on a malformed or
 * unrecognized hash — that's a data bug, not "wrong password," and should
 * fail loudly rather than silently report `false`.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const match = PHC_PATTERN.exec(hash);
  if (!match) {
    throw new Error(`Unrecognized password hash format: expected a $argon2id$... PHC string`);
  }
  const memory = requireGroup(match, 1);
  const passes = requireGroup(match, 2);
  const parallelism = requireGroup(match, 3);
  const saltB64 = requireGroup(match, 4);
  const tagB64 = requireGroup(match, 5);

  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(tagB64, "base64url");
  const actual = await argon2id(password, {
    nonce: salt,
    parallelism: Number(parallelism),
    tagLength: expected.length,
    memory: Number(memory),
    passes: Number(passes),
  });

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
