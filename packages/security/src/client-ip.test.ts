import { describe, expect, it } from "vitest";
import { clientIpFrom } from "./client-ip.js";

const isTrustedProxy = (peer: string) => peer === "10.0.0.5";

describe("clientIpFrom", () => {
  it("is the peer, and ignores X-Forwarded-For, when no proxy is trusted (the default)", () => {
    expect(clientIpFrom("10.0.0.5", "203.0.113.7")).toBe("10.0.0.5");
    expect(clientIpFrom("10.0.0.5", "203.0.113.7", { trustedProxyHops: 0 })).toBe("10.0.0.5");
  });

  it("is undefined when there is no peer at all", () => {
    expect(clientIpFrom(undefined, "203.0.113.7")).toBeUndefined();
    expect(clientIpFrom(undefined, "203.0.113.7", { trustedProxyHops: 1 })).toBeUndefined();
  });

  it("reads the last entry for one proxy, which is the one the proxy wrote", () => {
    expect(clientIpFrom("10.0.0.5", "203.0.113.7", { trustedProxyHops: 1 })).toBe("203.0.113.7");
  });

  it("never uses the left of the header, which a client can forge", () => {
    expect(clientIpFrom("10.0.0.5", "1.2.3.4, 203.0.113.7", { trustedProxyHops: 1 })).toBe("203.0.113.7");
    expect(clientIpFrom("10.0.0.5", "6.6.6.6, 1.2.3.4, 203.0.113.7", { trustedProxyHops: 1 })).toBe("203.0.113.7");
  });

  it("counts from the end for several proxies", () => {
    expect(clientIpFrom("10.0.0.5", "203.0.113.7, 198.51.100.1", { trustedProxyHops: 2 })).toBe("203.0.113.7");
    expect(clientIpFrom("10.0.0.5", "9.9.9.9, 203.0.113.7, 198.51.100.1", { trustedProxyHops: 2 })).toBe("203.0.113.7");
  });

  it("stays with the peer when the header has fewer entries than there are proxies", () => {
    expect(clientIpFrom("10.0.0.5", "203.0.113.7", { trustedProxyHops: 2 })).toBe("10.0.0.5");
  });

  it("stays with the peer when the header is missing, empty or not an address", () => {
    expect(clientIpFrom("10.0.0.5", null, { trustedProxyHops: 1 })).toBe("10.0.0.5");
    expect(clientIpFrom("10.0.0.5", "", { trustedProxyHops: 1 })).toBe("10.0.0.5");
    expect(clientIpFrom("10.0.0.5", "not-an-ip", { trustedProxyHops: 1 })).toBe("10.0.0.5");
    expect(clientIpFrom("10.0.0.5", "203.0.113.7:8080", { trustedProxyHops: 1 })).toBe("10.0.0.5");
  });

  it("accepts IPv6, and writes an IPv4-mapped address plainly", () => {
    expect(clientIpFrom("10.0.0.5", "2001:db8::7", { trustedProxyHops: 1 })).toBe("2001:db8::7");
    expect(clientIpFrom("10.0.0.5", "::ffff:203.0.113.7", { trustedProxyHops: 1 })).toBe("203.0.113.7");
  });

  it("tolerates spaces and empty items in the header", () => {
    expect(clientIpFrom("10.0.0.5", " 1.2.3.4 ,, 203.0.113.7 ", { trustedProxyHops: 1 })).toBe("203.0.113.7");
  });

  it("only reads the header when the peer is a proxy it trusts, if told which", () => {
    expect(clientIpFrom("10.0.0.5", "203.0.113.7", { trustedProxyHops: 1, isTrustedProxy })).toBe("203.0.113.7");
    expect(clientIpFrom("198.51.100.99", "203.0.113.7", { trustedProxyHops: 1, isTrustedProxy })).toBe("198.51.100.99");
  });

  it.each([[-1], [1.5], [Number.NaN]])("refuses %s hops", (hops) => {
    expect(() => clientIpFrom("10.0.0.5", "203.0.113.7", { trustedProxyHops: hops })).toThrow(RangeError);
  });
});
