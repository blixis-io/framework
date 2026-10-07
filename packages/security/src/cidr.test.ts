import { describe, expect, it } from "vitest";
import { clientIpFrom } from "./client-ip.js";
import { createIpMatcher, ipInCidrs, parseCidr } from "./cidr.js";
import { SecurityConfigError } from "./errors.js";

describe("parseCidr", () => {
  it("reads IPv4 and IPv6 networks, and a bare address as one host", () => {
    expect(parseCidr("10.0.0.0/8")).toEqual({ family: 4, prefix: 8, network: 10n << 24n });
    expect(parseCidr("0.0.0.0/0")).toEqual({ family: 4, prefix: 0, network: 0n });
    expect(parseCidr("203.0.113.7")).toMatchObject({ family: 4, prefix: 32 });
    expect(parseCidr("203.0.113.7/32")).toMatchObject({ family: 4, prefix: 32 });
    expect(parseCidr("2001:db8::/32")).toEqual({ family: 6, prefix: 32, network: 0x2001_0db8n << 96n });
    expect(parseCidr("::/0")).toMatchObject({ family: 6, prefix: 0 });
    expect(parseCidr("2001:db8::1")).toMatchObject({ family: 6, prefix: 128 });
  });

  it("reads an IPv4-mapped IPv6 network as the IPv4 network it covers", () => {
    expect(parseCidr("::ffff:10.0.0.0/104")).toEqual(parseCidr("10.0.0.0/8"));
    expect(parseCidr("::ffff:a00:0/104")).toEqual(parseCidr("10.0.0.0/8"));
    expect(parseCidr("::ffff:10.0.0.1")).toEqual(parseCidr("10.0.0.1/32"));
    expect(parseCidr("::ffff:0:0/96")).toEqual(parseCidr("0.0.0.0/0"));
  });

  it.each([
    ["", "empty"],
    ["/8", "no address"],
    ["10.0.0.0/", "empty prefix"],
    ["10.0.0.0/8/8", "two slashes"],
    ["10.0.0.0/33", "prefix too big for IPv4"],
    ["::1/129", "prefix too big for IPv6"],
    ["10.0.0.0/-1", "negative prefix"],
    ["10.0.0.0/+8", "signed prefix"],
    ["10.0.0.0/08", "leading zero in the prefix"],
    ["10.0.0.0/8 ", "trailing space"],
    [" 10.0.0.0/8", "leading space"],
    ["10.0.0.0/8.0", "decimal prefix"],
    ["10.0.0.0/0x8", "hex prefix"],
    ["10.0.0.0/８", "full-width digit prefix"],
    ["１０.0.0.0/8", "full-width digit address"],
    ["10.0.0/8", "three octets"],
    ["10.0.0.0.0/8", "five octets"],
    ["010.0.0.0/8", "leading zero in an octet"],
    ["256.0.0.0/8", "octet out of range"],
    ["0x0a.0.0.0/8", "hex octet"],
    ["167772160/8", "single decimal number"],
    ["10.1.2.3/8", "host bits set"],
    ["192.168.1.5/24", "host bits set (copied from ifconfig)"],
    ["2001:db8::1/32", "host bits set in IPv6"],
    ["fe80::1%eth0/64", "zone id"],
    ["::1%1/128", "numeric zone id"],
    ["::ffff:10.0.0.0/64", "mapped network with a prefix below 96"],
    ["::ffff:10.0.0.0/129", "mapped network with a prefix above 128"],
    ["example.com/8", "a hostname"],
    ["10.0.0.0/8\n", "trailing newline"],
  ])("refuses %j (%s)", (text) => {
    expect(() => parseCidr(text)).toThrow(SecurityConfigError);
  });

  it("says which network was probably meant when host bits are set", () => {
    expect(() => parseCidr("192.168.1.5/24")).toThrow("192.168.1.0/24");
    expect(() => parseCidr("10.1.2.3/8")).toThrow("10.0.0.0/8");
  });
});

describe("createIpMatcher", () => {
  const inside = createIpMatcher(["10.0.0.0/8", "192.168.1.0/24", "203.0.113.7", "2001:db8::/32"]);

  it("is true inside any listed network, at both edges, and false just outside", () => {
    expect(inside("10.0.0.0")).toBe(true);
    expect(inside("10.255.255.255")).toBe(true);
    expect(inside("9.255.255.255")).toBe(false);
    expect(inside("11.0.0.0")).toBe(false);
    expect(inside("192.168.1.0")).toBe(true);
    expect(inside("192.168.1.255")).toBe(true);
    expect(inside("192.168.2.0")).toBe(false);
    expect(inside("203.0.113.7")).toBe(true);
    expect(inside("203.0.113.8")).toBe(false);
    expect(inside("2001:db8::")).toBe(true);
    expect(inside("2001:db8:ffff:ffff:ffff:ffff:ffff:ffff")).toBe(true);
    expect(inside("2001:db9::")).toBe(false);
  });

  it("matches IPv6 whatever its spelling", () => {
    expect(inside("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(true);
    expect(inside("2001:DB8::1")).toBe(true);
    expect(inside("2001:db8:0:0:0:0:0:1")).toBe(true);
  });

  it("matches an IPv4-mapped address as the IPv4 address it carries, in either spelling", () => {
    expect(inside("::ffff:10.1.2.3")).toBe(true);
    expect(inside("::FFFF:a01:203")).toBe(true);
    expect(inside("::ffff:11.1.2.3")).toBe(false);
  });

  it("keeps the families apart: ::/0 is every real IPv6 address and no IPv4 one, and the other way round", () => {
    const v6 = createIpMatcher(["::/0"]);
    const v4 = createIpMatcher(["0.0.0.0/0"]);
    expect(v6("2001:db8::1")).toBe(true);
    expect(v6("10.0.0.1")).toBe(false);
    expect(v6("::ffff:10.0.0.1")).toBe(false);
    expect(v4("10.0.0.1")).toBe(true);
    expect(v4("::ffff:10.0.0.1")).toBe(true);
    expect(v4("2001:db8::1")).toBe(false);
  });

  it("a /32 is one host, a /0 is everything", () => {
    expect(createIpMatcher(["203.0.113.7/32"])("203.0.113.7")).toBe(true);
    expect(createIpMatcher(["203.0.113.7/32"])("203.0.113.6")).toBe(false);
    expect(createIpMatcher(["0.0.0.0/0"])("255.255.255.255")).toBe(true);
  });

  it("is false for an empty list", () => {
    expect(createIpMatcher([])("10.0.0.1")).toBe(false);
  });

  it.each([
    undefined,
    "",
    " ",
    "10.0.0.1 ",
    " 10.0.0.1",
    "10.0.0.1\n",
    "10.0.0",
    "10.0.0.1.1",
    "10.0.0.256",
    "010.0.0.1",
    "10.0.0.01",
    "0x0a.0.0.1",
    "167772161",
    "10.0.0.1/8",
    "fe80::1%eth0",
    "2001:db8::/32",
    "2001:db8::g",
    "2001:db8:::1",
    "1:2:3:4:5:6:7:8:9",
    "localhost",
    "10.0.0.1, 10.0.0.2",
    "１０.0.0.1",
  ])("is false, and never throws, for %j", (ip) => {
    const everything = createIpMatcher(["0.0.0.0/0", "::/0"]);
    expect(everything(ip)).toBe(false);
  });

  it("refuses a bad network when the matcher is built, not when it is used", () => {
    expect(() => createIpMatcher(["10.0.0.0/8", "10.0.0.0/99"])).toThrow(SecurityConfigError);
  });

  it("accepts networks that are already parsed", () => {
    expect(createIpMatcher([parseCidr("10.0.0.0/8")])("10.1.1.1")).toBe(true);
  });
});

describe("ipInCidrs", () => {
  it("is the one-off form", () => {
    expect(ipInCidrs("10.1.1.1", ["10.0.0.0/8"])).toBe(true);
    expect(ipInCidrs("11.1.1.1", ["10.0.0.0/8"])).toBe(false);
    expect(ipInCidrs(undefined, ["0.0.0.0/0"])).toBe(false);
  });
});

describe("with getClientIp's isTrustedProxy", () => {
  const isTrustedProxy = createIpMatcher(["10.0.0.0/8", "fd00::/8"]);

  it("reads X-Forwarded-For only from a peer inside the proxy networks", () => {
    expect(clientIpFrom("10.2.3.4", "203.0.113.7", { trustedProxyHops: 1, isTrustedProxy })).toBe("203.0.113.7");
    expect(clientIpFrom("::ffff:10.2.3.4", "203.0.113.7", { trustedProxyHops: 1, isTrustedProxy })).toBe("203.0.113.7");
    expect(clientIpFrom("fd12::1", "203.0.113.7", { trustedProxyHops: 1, isTrustedProxy })).toBe("203.0.113.7");
    expect(clientIpFrom("198.51.100.9", "203.0.113.7", { trustedProxyHops: 1, isTrustedProxy })).toBe("198.51.100.9");
  });
});
