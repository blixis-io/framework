import { isIP } from "node:net";
import { SecurityConfigError } from "./errors.js";

/** A parsed network: an address family, the first `prefix` bits that must match, and those bits as a number. */
export interface Cidr {
  readonly family: 4 | 6;
  readonly prefix: number;
  /** The whole network address as an integer (32 or 128 bits), with every bit after `prefix` zero. */
  readonly network: bigint;
}

interface Address {
  family: 4 | 6;
  value: bigint;
}

const WIDTH = { 4: 32, 6: 128 } as const;
/** `::ffff:0:0/96`: where an IPv4 address lives inside IPv6 (what a dual-stack socket reports). */
const MAPPED_PREFIX = 0xffffn << 32n;
const MAPPED_MASK = ((1n << 96n) - 1n) << 32n;

function parseV4(text: string): bigint {
  let value = 0n;
  for (const part of text.split(".")) {
    value = (value << 8n) | BigInt(part);
  }
  return value;
}

const splitGroups = (part: string) => (part === "" ? [] : part.split(":"));

function parseV6(text: string): bigint {
  // An embedded IPv4 tail (`::ffff:10.0.0.1`) is two groups.
  let rest = text;
  const dot = rest.lastIndexOf(".");
  if (dot !== -1) {
    const colon = rest.lastIndexOf(":");
    const tail = parseV4(rest.slice(colon + 1));
    rest = `${rest.slice(0, colon + 1)}${(tail >> 16n).toString(16)}:${(tail & 0xffffn).toString(16)}`;
  }
  const [head = "", tail, ...extra] = rest.split("::");
  if (extra.length > 0) {
    throw new RangeError("more than one ::");
  }
  const before = splitGroups(head);
  const after = tail === undefined ? [] : splitGroups(tail);
  const missing = 8 - before.length - after.length;
  const all = tail === undefined ? before : [...before, ...Array.from({ length: missing }, () => "0"), ...after];
  let value = 0n;
  for (const group of all) {
    value = (value << 16n) | BigInt(`0x${group}`);
  }
  return value;
}

/**
 * Reads an IP address, or `undefined` for anything that is not exactly one. Strict on purpose: no zone id (`%eth0`), no
 * surrounding space, no leading zeros, no hex or decimal shortcuts (`0x7f.1`, `2130706433`), which different parsers read
 * differently and which are how an allowlist gets bypassed. An IPv4-mapped IPv6 address is the IPv4 address it carries.
 */
function parseAddress(text: string): Address | undefined {
  const family = isIP(text);
  if (family === 0 || text.includes("%")) {
    return undefined;
  }
  if (family === 4) {
    return { family: 4, value: parseV4(text) };
  }
  const value = parseV6(text);
  if ((value & MAPPED_MASK) === MAPPED_PREFIX) {
    return { family: 4, value: value & 0xffff_ffffn };
  }
  return { family: 6, value };
}

/**
 * Reads `"10.0.0.0/8"`, `"2001:db8::/32"` or a single address (`"203.0.113.7"`, meaning one host). Throws a
 * `SecurityConfigError` for anything else, so a typo in an allowlist stops the application at boot and does not silently
 * match nothing (or, worse, everything).
 *
 * Refused, with the reason in the message: a prefix that is not plain digits or is out of range, and an address with bits
 * set after the prefix (`10.1.2.3/8`): that is usually a mistake about which network was meant, and an allowlist should
 * not guess. An IPv4-mapped IPv6 network (`::ffff:10.0.0.0/104`) is read as the IPv4 network it covers.
 */
export function parseCidr(text: string): Cidr {
  const fail = (reason: string): never => {
    throw new SecurityConfigError(`"${text}" is not a valid network: ${reason}.`);
  };
  const parts = text.split("/");
  if (parts.length > 2) {
    return fail("more than one \"/\"");
  }
  const address = parseAddress(parts[0] ?? "");
  if (!address) {
    return fail("the address is not an IPv4 or IPv6 address (no zone ids, spaces, leading zeros or number shortcuts)");
  }
  const width = WIDTH[address.family];
  const given = parts[1];
  if (given !== undefined && !/^(0|[1-9][0-9]{0,2})$/.test(given)) {
    return fail("the prefix must be a whole number without a sign, spaces or leading zeros");
  }
  // `text.includes(".")` tells a mapped address written in IPv6 form apart from a plain IPv4 one, whose prefix is out of 32.
  const mapped = address.family === 4 && text.includes(":");
  let prefix = given === undefined ? width : Number(given);
  if (mapped) {
    prefix = given === undefined ? 32 : prefix - 96;
    if (prefix < 0) {
      return fail("an IPv4-mapped network needs a prefix of at least 96");
    }
  }
  const max = mapped ? 128 : width;
  if ((given === undefined ? 0 : Number(given)) > max) {
    return fail(`the prefix cannot be more than ${max}`);
  }
  const hostBits = BigInt(width - prefix);
  if (address.value & ((1n << hostBits) - 1n)) {
    const network = (address.value >> hostBits) << hostBits;
    return fail(`it has bits set after the /${given ?? prefix}; the network address would be ${format(address.family, network)}/${prefix}`);
  }
  return { family: address.family, prefix, network: address.value };
}

function format(family: 4 | 6, value: bigint): string {
  if (family === 4) {
    return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 0xffn)).join(".");
  }
  const groups = Array.from({ length: 8 }, (_, index) => ((value >> BigInt(112 - index * 16)) & 0xffffn).toString(16));
  return groups.join(":");
}

/**
 * Parses the networks once and returns a function that says whether an address is inside any of them. An address that is
 * not a valid IP (a missing one, a zone id, a hostname, `"1.2.3"`, `"0x7f.0.0.1"`) is **not inside**: it never throws, and
 * it never matches, whatever the list holds. An IPv4-mapped IPv6 address (`::ffff:10.0.0.1`, what a dual-stack socket
 * reports) is matched as the IPv4 address it carries; IPv4 and IPv6 networks never match each other's addresses
 * (`::/0` is every real IPv6 address, `0.0.0.0/0` every IPv4 one).
 *
 * It fits `isTrustedProxy` of `getClientIp` directly: `isTrustedProxy: createIpMatcher(["10.0.0.0/8"])`.
 */
export function createIpMatcher(networks: readonly (string | Cidr)[]): (ip: string | undefined) => boolean {
  const parsed = networks.map((network) => (typeof network === "string" ? parseCidr(network) : network));
  return (ip) => {
    const address = ip === undefined ? undefined : parseAddress(ip);
    if (!address) {
      return false;
    }
    const width = WIDTH[address.family];
    return parsed.some((cidr) => {
      if (cidr.family !== address.family) {
        return false;
      }
      const shift = BigInt(width - cidr.prefix);
      return address.value >> shift === cidr.network >> shift;
    });
  };
}

/** One-off form of `createIpMatcher`. Parses the networks on every call: build a matcher once for a hot path. */
export function ipInCidrs(ip: string | undefined, networks: readonly (string | Cidr)[]): boolean {
  return createIpMatcher(networks)(ip);
}
