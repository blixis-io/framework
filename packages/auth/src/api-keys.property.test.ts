import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKeySecret, parseApiKey } from "./api-keys.js";

describe("parseApiKey", () => {
  it("reads back every key that was generated, to the id and secret it was made from", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const made = generateApiKey();
        const parsed = parseApiKey(made.key);

        expect(parsed?.id).toBe(made.id);
        expect(hashApiKeySecret(parsed?.secret ?? "")).toBe(made.secretHash);
      }),
      { numRuns: 1000 },
    );
  });

  it("never throws, and whatever it accepts is exactly blx_<24 hex>_<43 base64url> and rebuilds the input", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 300 }), (text) => {
        const parsed = parseApiKey(text);

        expect(parsed === undefined || (/^[0-9a-f]{24}$/.test(parsed.id) && /^[A-Za-z0-9_-]{43}$/.test(parsed.secret) && `blx_${parsed.id}_${parsed.secret}` === text)).toBe(true);
      }),
      { numRuns: 5000 },
    );
  });

  it("refuses a valid key with any one character changed to something outside its alphabet, or one added or removed", () => {
    fc.assert(
      fc.property(fc.nat(), fc.constantFrom(" ", "\n", "!", "=", "/", "+", ".", "\0", "é"), fc.constantFrom("replace", "insert", "remove"), (position, character, operation) => {
        const { key } = generateApiKey();
        const at = position % key.length;
        const changed =
          operation === "replace" ? key.slice(0, at) + character + key.slice(at + 1) : operation === "insert" ? key.slice(0, at) + character + key.slice(at) : key.slice(0, at) + key.slice(at + 1);
        // Removing or replacing a separator or a character of the prefix is covered too: all of these leave the format.

        expect(parseApiKey(changed)).toBeUndefined();
      }),
      { numRuns: 2000 },
    );
  });
});
