import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createIpMatcher, parseCidr } from "./cidr.js";
import { SecurityConfigError } from "./errors.js";

// The matcher is checked against a model that shares no code and no idea with it: addresses as strings of bits, and
// "inside" as "the first `prefix` characters are equal". The real one is integer arithmetic on BigInt.

const octet = fc.integer({ min: 0, max: 255 });
const v4 = fc.tuple(octet, octet, octet, octet);
const hextet = fc.integer({ min: 0, max: 0xffff });
const v6 = fc.array(hextet, { minLength: 8, maxLength: 8 });

const bits = (numbers: readonly number[], width: 8 | 16) => numbers.map((n) => n.toString(2).padStart(width, "0")).join("");
const fromBits = (text: string, width: 8 | 16) => Array.from({ length: text.length / width }, (_, index) => Number.parseInt(text.slice(index * width, (index + 1) * width), 2));
const dotted = (numbers: readonly number[]) => numbers.join(".");
const full = (numbers: readonly number[]) => numbers.map((n) => n.toString(16)).join(":");

/** The same address with its longest run of zero groups written as `::`, the way people and tools write it. */
function compressed(numbers: readonly number[]): string {
  let best = { start: -1, length: 0 };
  for (let start = 0; start < 8; start += 1) {
    let length = 0;
    while (start + length < 8 && numbers[start + length] === 0) {
      length += 1;
    }
    if (length > best.length) {
      best = { start, length };
    }
  }
  if (best.length < 2) {
    return full(numbers);
  }
  const left = numbers.slice(0, best.start).map((n) => n.toString(16)).join(":");
  const right = numbers.slice(best.start + best.length).map((n) => n.toString(16)).join(":");
  return `${left}::${right}`;
}

/** The network address with every bit after `prefix` cleared, by the model. */
const networkBits = (address: string, prefix: number) => address.slice(0, prefix) + "0".repeat(address.length - prefix);
const flip = (text: string, position: number) => text.slice(0, position) + (text[position] === "0" ? "1" : "0") + text.slice(position + 1);

describe("createIpMatcher against a bit-string model", () => {
  it("IPv4: an address is inside exactly when its first `prefix` bits equal the network's", () => {
    fc.assert(
      fc.property(v4, v4, fc.integer({ min: 0, max: 32 }), (networkSeed, candidate, prefix) => {
        const network = networkBits(bits(networkSeed, 8), prefix);
        const cidr = `${dotted(fromBits(network, 8))}/${prefix}`;
        const expected = bits(candidate, 8).slice(0, prefix) === network.slice(0, prefix);

        expect(createIpMatcher([cidr])(dotted(candidate))).toBe(expected);
      }),
      { numRuns: 2000 },
    );
  });

  it("IPv4: flipping one bit of the network address leaves exactly when that bit is inside the prefix", () => {
    fc.assert(
      fc.property(v4, fc.integer({ min: 0, max: 32 }), fc.integer({ min: 0, max: 31 }), (seed, prefix, position) => {
        const network = networkBits(bits(seed, 8), prefix);
        const matcher = createIpMatcher([`${dotted(fromBits(network, 8))}/${prefix}`]);

        expect(matcher(dotted(fromBits(network, 8)))).toBe(true);
        expect(matcher(dotted(fromBits(flip(network, position), 8)))).toBe(position >= prefix);
      }),
      { numRuns: 2000 },
    );
  });

  it("IPv6: the same, whatever the spelling of the address", () => {
    fc.assert(
      fc.property(v6, v6, fc.integer({ min: 0, max: 128 }), (networkSeed, candidate, prefix) => {
        // Keep clear of ::ffff:0:0/96, where an address is really an IPv4 one (covered separately).
        fc.pre(!(bits(candidate, 16).startsWith("0".repeat(80) + "1".repeat(16))));
        const network = networkBits(bits(networkSeed, 16), prefix);
        fc.pre(!network.startsWith("0".repeat(80) + "1".repeat(16)));
        const networkGroups = fromBits(network, 16);
        const expected = bits(candidate, 16).slice(0, prefix) === network.slice(0, prefix);

        for (const spelling of [full, compressed, (n: readonly number[]) => full(n).toUpperCase()]) {
          expect(createIpMatcher([`${spelling(networkGroups)}/${prefix}`])(spelling(candidate))).toBe(expected);
        }
      }),
      { numRuns: 1500 },
    );
  });

  it("IPv6: flipping one bit leaves exactly when that bit is inside the prefix", () => {
    fc.assert(
      fc.property(v6, fc.integer({ min: 0, max: 128 }), fc.integer({ min: 0, max: 127 }), (seed, prefix, position) => {
        const network = networkBits(bits(seed, 16), prefix);
        const flipped = flip(network, position);
        fc.pre(![network, flipped].some((text) => text.startsWith("0".repeat(80) + "1".repeat(16))));
        const matcher = createIpMatcher([`${compressed(fromBits(network, 16))}/${prefix}`]);

        expect(matcher(compressed(fromBits(network, 16)))).toBe(true);
        expect(matcher(compressed(fromBits(flipped, 16)))).toBe(position >= prefix);
      }),
      { numRuns: 1500 },
    );
  });

  it("an IPv4-mapped IPv6 address is inside exactly when its IPv4 address is, in dotted and hex spelling", () => {
    fc.assert(
      fc.property(v4, v4, fc.integer({ min: 0, max: 32 }), (networkSeed, candidate, prefix) => {
        const network = networkBits(bits(networkSeed, 8), prefix);
        const matcher = createIpMatcher([`${dotted(fromBits(network, 8))}/${prefix}`]);
        const plain = matcher(dotted(candidate));
        const [a, b, c, d] = candidate;

        expect(matcher(`::ffff:${dotted(candidate)}`)).toBe(plain);
        expect(matcher(`::ffff:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`)).toBe(plain);
      }),
      { numRuns: 1000 },
    );
  });

  it("an IPv4-mapped network means the IPv4 network, for every prefix of 96 and up", () => {
    fc.assert(
      fc.property(v4, fc.integer({ min: 96, max: 128 }), v4, (seed, prefix, candidate) => {
        const network = networkBits(bits(seed, 8), prefix - 96);
        const mapped = parseCidr(`::ffff:${dotted(fromBits(network, 8))}/${prefix}`);
        const plain = parseCidr(`${dotted(fromBits(network, 8))}/${prefix - 96}`);

        expect(mapped).toEqual(plain);
        expect(createIpMatcher([mapped])(dotted(candidate))).toBe(createIpMatcher([plain])(dotted(candidate)));
      }),
      { numRuns: 500 },
    );
  });

  it("the families never match each other's addresses (outside the mapped range)", () => {
    fc.assert(
      fc.property(v4, v6, (a, b) => {
        fc.pre(!bits(b, 16).startsWith("0".repeat(80) + "1".repeat(16)));

        expect(createIpMatcher(["::/0"])(dotted(a))).toBe(false);
        expect(createIpMatcher(["0.0.0.0/0"])(full(b))).toBe(false);
      }),
      { numRuns: 500 },
    );
  });
});

describe("on arbitrary text", () => {
  it("an address that is not an IP is never inside, and asking never throws", () => {
    const everything = createIpMatcher(["0.0.0.0/0", "::/0"]);
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (text) => {
        const notAnAddress = /[^0-9a-fA-F.:]/.test(text);

        // A string with a character that no address contains is never inside, even of "everything".
        expect(notAnAddress && everything(text)).toBe(false);
      }),
      { numRuns: 3000 },
    );
  });

  it("a network is either refused with a SecurityConfigError, or its own address is inside it", () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom("0", "1", "2", "7", "8", "9", "a", "f", "b", ".", ":", "/", " ", "%", "x", "-", "+") }), (text) => {
        const outcome = attempt(text);

        expect(outcome.error === undefined || outcome.error instanceof SecurityConfigError).toBe(true);
        expect(outcome.cidr === undefined || createIpMatcher([text])(text.split("/")[0])).toBe(true);
      }),
      { numRuns: 5000 },
    );
  });
});

function attempt(text: string): { cidr?: ReturnType<typeof parseCidr>; error?: unknown } {
  try {
    return { cidr: parseCidr(text) };
  } catch (error) {
    return { error };
  }
}
