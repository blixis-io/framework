import { describe, expect, it } from "vitest";
import { COMMON_SECRET_KEYS, REDACTED, safeStringify, toJsonSafe } from "./serialize.js";

const parse = (value: unknown, redact?: readonly string[]): unknown => JSON.parse(safeStringify(value, redact));

/** The value at `path` inside nested objects, so a test can look inside a result without casting it. */
function at(value: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>((current, key) => (typeof current === "object" && current !== null ? Reflect.get(current, key) : undefined), value);
}

function handler() {}


describe("toJsonSafe: errors", () => {
  it("keeps an Error's name, message and stack instead of turning it into {}", () => {
    const error = new TypeError("bad input");

    const out = toJsonSafe({ error });

    expect(at(out, "error", "name")).toBe("TypeError");
    expect(at(out, "error", "message")).toBe("bad input");
    expect(String(at(out, "error", "stack"))).toContain("TypeError: bad input");
  });

  it("keeps the properties an error carries, such as a code", () => {
    const error = Object.assign(new Error("connect failed"), { code: "ECONNREFUSED", port: 5432 });

    expect(toJsonSafe(error)).toMatchObject({ message: "connect failed", code: "ECONNREFUSED", port: 5432 });
  });

  it("follows a cause chain", () => {
    const error = new Error("outer", { cause: new Error("inner", { cause: "root cause text" }) });

    const out = toJsonSafe(error);

    expect(at(out, "cause", "message")).toBe("inner");
    expect(at(out, "cause", "cause")).toBe("root cause text");
  });

  it("lists the errors of an AggregateError", () => {
    const error = new AggregateError([new Error("a"), new Error("b")], "two failed");

    const out = toJsonSafe(error);

    expect([at(out, "errors", "0", "message"), at(out, "errors", "1", "message")]).toEqual(["a", "b"]);
  });

  it("does not follow an error that is its own cause forever", () => {
    const error = new Error("loop");
    error.cause = error;

    expect(() => safeStringify(error)).not.toThrow();
    expect(safeStringify(error)).toContain("[Circular]");
  });
});

describe("toJsonSafe: values JSON.stringify can't handle", () => {
  it("marks a circular reference instead of throwing", () => {
    const node: Record<string, unknown> = { id: 1 };
    node["self"] = node;

    expect(parse({ node })).toEqual({ node: { id: 1, self: "[Circular]" } });
  });

  it("only calls it circular when it is an ancestor: the same object twice is fine", () => {
    const shared = { n: 1 };

    expect(parse({ a: shared, b: shared, list: [shared, shared] })).toEqual({ a: { n: 1 }, b: { n: 1 }, list: [{ n: 1 }, { n: 1 }] });
  });

  it("writes a BigInt as text instead of throwing", () => {
    expect(parse({ id: 9007199254740993n })).toEqual({ id: "9007199254740993" });
  });

  it("describes functions and symbols, which JSON drops silently", () => {
    expect(parse({ handler, tag: Symbol("t") })).toEqual({ handler: "[Function: handler]", tag: "Symbol(t)" });
  });

  it("writes Map and Set as data", () => {
    expect(parse({ map: new Map([["a", 1]]), set: new Set([1, 2]) })).toEqual({ map: [["a", 1]], set: [1, 2] });
  });

  it("uses toJSON, so a Date is an ISO string", () => {
    expect(parse({ at: new Date("2026-10-05T10:00:00.000Z") })).toEqual({ at: "2026-10-05T10:00:00.000Z" });
  });

  it("survives a getter that throws", () => {
    const hostile = {
      get boom(): string {
        throw new Error("no access");
      },
      fine: 1,
    };

    expect(parse({ hostile })).toEqual({ hostile: { boom: "[Unreadable: no access]", fine: 1 } });
  });

  it("stops at a sane depth instead of recursing without end", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let level = 0; level < 50; level++) {
      deep = { child: deep };
    }

    const text = safeStringify(deep);

    expect(text).toContain("[Object]");
    expect(text.length).toBeLessThan(1000);
  });

  it("leaves ordinary data alone", () => {
    expect(parse({ a: 1, b: "two", c: [true, null], d: { e: undefined } })).toEqual({ a: 1, b: "two", c: [true, null], d: {} });
  });
});

describe("redaction", () => {
  it("replaces the value of a listed key wherever it appears, whatever its type", () => {
    const out = parse({ user: "ada", password: "hunter2", nested: { token: { id: 1 }, keep: 1 }, list: [{ password: "x" }] }, ["password", "token"]);

    expect(out).toEqual({ user: "ada", password: REDACTED, nested: { token: REDACTED, keep: 1 }, list: [{ password: REDACTED }] });
  });

  it("matches key names without regard to case, and only whole names", () => {
    const out = parse({ Authorization: "Bearer abc", PASSWORD: "p", passwordHint: "visible", tokens: 5 }, ["authorization", "password", "token"]);

    expect(out).toEqual({ Authorization: REDACTED, PASSWORD: REDACTED, passwordHint: "visible", tokens: 5 });
  });

  it("reaches into an Error's own properties and cause", () => {
    const error = Object.assign(new Error("login failed", { cause: Object.assign(new Error("inner"), { password: "p" }) }), { token: "t" });

    const out = toJsonSafe(error, ["token", "password"]);

    expect(at(out, "token")).toBe(REDACTED);
    expect(at(out, "cause", "password")).toBe(REDACTED);
  });

  it("does not change the object it was given", () => {
    const input = { password: "hunter2" };

    toJsonSafe(input, ["password"]);

    expect(input.password).toBe("hunter2");
  });

  it("does nothing without a list", () => {
    expect(parse({ password: "visible" })).toEqual({ password: "visible" });
  });

  it("ships a list of the key names that usually hold secrets", () => {
    expect(COMMON_SECRET_KEYS).toEqual(expect.arrayContaining(["password", "token", "authorization", "cookie", "secret", "apikey"]));
  });
});

describe("safeStringify", () => {
  it("never throws, whatever it is given", () => {
    const circular: Record<string, unknown> = {};
    circular["me"] = circular;

    expect(() => safeStringify(circular)).not.toThrow();
    expect(() => safeStringify({ big: 1n, fn: () => 1, err: new Error("x") })).not.toThrow();
    expect(safeStringify(undefined)).toBe("undefined");
  });
});
