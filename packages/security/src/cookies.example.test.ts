import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { clearCookie, parseCookies, serializeCookie } from "./cookies.example.js";

describe("serializeCookie", () => {
  it("is Secure, HttpOnly, SameSite=Lax and Path=/ unless told otherwise", () => {
    expect(serializeCookie("sid", "abc")).toBe("sid=abc; Path=/; Secure; HttpOnly; SameSite=Lax");
  });

  it("writes every attribute asked for", () => {
    expect(serializeCookie("sid", "abc", { maxAge: 3600, path: "/auth", domain: "example.com", sameSite: "Strict" })).toBe(
      "sid=abc; Path=/auth; Max-Age=3600; Domain=example.com; Secure; HttpOnly; SameSite=Strict",
    );
  });

  it("clears a cookie with Max-Age=0 and the same attributes", () => {
    expect(clearCookie("sid", { path: "/auth" })).toBe("sid=; Path=/auth; Max-Age=0; Secure; HttpOnly; SameSite=Lax");
  });

  it("percent-encodes the value, so a semicolon or a line break cannot become an attribute or a new header", () => {
    const header = serializeCookie("sid", "a; Domain=evil.example\r\nSet-Cookie: x=1");

    expect(header).not.toMatch(/[\r\n]/);
    expect(header.split(";")).toHaveLength(5); // name=value, Path, Secure, HttpOnly, SameSite: nothing was injected
    expect(header).toContain("a%3B%20Domain%3Devil.example%0D%0ASet-Cookie%3A%20x%3D1");
  });

  it.each([
    ["", "empty name"],
    ["a b", "space in the name"],
    ["a;b", "semicolon in the name"],
    ["a=b", "equals in the name"],
    ["a\r\nb", "line break in the name"],
    ["é", "non-ASCII name"],
  ])("refuses the name %j (%s)", (name) => {
    expect(() => serializeCookie(name, "v")).toThrow(TypeError);
  });

  it.each(["", "auth", "/a b", "/a;b", "/a\r\nb", "/é"])("refuses the path %j", (path) => {
    expect(() => serializeCookie("a", "v", { path })).toThrow(TypeError);
  });

  it.each(["", "ex ample.com", "example.com; Path=/", "exa\r\nmple.com", "-example.com", "example.com-", "ex_ample.com"])("refuses the domain %j", (domain) => {
    expect(() => serializeCookie("a", "v", { domain })).toThrow(TypeError);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses maxAge %j", (maxAge) => {
    expect(() => serializeCookie("a", "v", { maxAge })).toThrow(RangeError);
  });

  it("refuses SameSite=None without Secure, which a browser would discard", () => {
    expect(() => serializeCookie("a", "v", { sameSite: "None", secure: false })).toThrow("requires Secure");
    expect(serializeCookie("a", "v", { sameSite: "None" })).toContain("SameSite=None");
  });

  it("keeps the promises a cookie name makes: __Host- needs Secure, Path=/ and no Domain; __Secure- needs Secure", () => {
    expect(serializeCookie("__Host-sid", "v")).toContain("Path=/");
    expect(() => serializeCookie("__Host-sid", "v", { secure: false })).toThrow("must be Secure");
    expect(() => serializeCookie("__Host-sid", "v", { path: "/api" })).toThrow("Path=/ and no Domain");
    expect(() => serializeCookie("__Host-sid", "v", { domain: "example.com" })).toThrow("Path=/ and no Domain");
    expect(() => serializeCookie("__Secure-sid", "v", { secure: false })).toThrow("must be Secure");
    expect(serializeCookie("__Secure-sid", "v", { domain: "example.com" })).toContain("Domain=example.com");
  });

  it("refuses a cookie bigger than browsers keep", () => {
    expect(() => serializeCookie("a", "x".repeat(5000))).toThrow(RangeError);
    expect(serializeCookie("a", "x".repeat(3000))).toContain("x".repeat(3000));
  });
});

describe("parseCookies", () => {
  it("reads name=value pairs", () => {
    expect([...parseCookies("a=1; b=two; c=3")]).toEqual([
      ["a", "1"],
      ["b", "two"],
      ["c", "3"],
    ]);
  });

  it("is empty for no header", () => {
    expect(parseCookies(null).size).toBe(0);
    expect(parseCookies(undefined).size).toBe(0);
    expect(parseCookies("").size).toBe(0);
  });

  it("lets the first cookie of a name win, so a planted second one cannot replace yours", () => {
    expect(parseCookies("sid=mine; sid=planted").get("sid")).toBe("mine");
  });

  it("skips what is not a cookie: no equals sign, a bad name, a bad percent-encoding", () => {
    expect([...parseCookies("junk; =novalue; a b=1; ok=fine; bad=%E0%A4%A")]).toEqual([["ok", "fine"]]);
  });

  it("strips one pair of surrounding quotes and decodes percent-encoding", () => {
    expect(parseCookies('a="quoted"; b=%C3%A9').get("a")).toBe("quoted");
    expect(parseCookies('a="quoted"; b=%C3%A9').get("b")).toBe("é");
  });

  it("keeps an equals sign inside a value", () => {
    expect(parseCookies("token=abc==").get("token")).toBe("abc==");
  });
});

describe("serialize and parse together", () => {
  it("any value comes back exactly, whatever it holds", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 500 }), (value) => {
        const header = serializeCookie("v", value);
        const sent = header.split(";")[0] ?? "";

        expect(parseCookies(sent).get("v")).toBe(value);
      }),
      { numRuns: 3000 },
    );
  });

  it("a value can never add an attribute or a header, whatever it holds", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 500 }), (value) => {
        const header = serializeCookie("v", value);

        expect(header).not.toMatch(/[\r\n]/);
        expect(header.split(";")).toHaveLength(5);
      }),
      { numRuns: 3000 },
    );
  });

  it("parsing never throws, whatever the header holds", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 500 }), (header) => {
        expect(() => parseCookies(header)).not.toThrow();
      }),
      { numRuns: 3000 },
    );
  });
});
