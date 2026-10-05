import { describe, expect, it, vi } from "vitest";
import { consoleTransport } from "./console.js";
import type { LogRecord } from "../types.js";

function record(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    level: "info",
    message: "hi",
    timestamp: "2026-09-29T12:00:00.000Z",
    context: {},
    ...overrides,
  };
}

describe("consoleTransport: level routing", () => {
  it.each([
    ["trace", "log"],
    ["debug", "debug"],
    ["info", "info"],
    ["warn", "warn"],
    ["error", "error"],
    ["fatal", "error"],
  ] as const)("routes level %s to console.%s", (level, method) => {
    const spy = vi.spyOn(console, method).mockImplementation(() => {});

    void consoleTransport().log(record({ level }));

    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe("consoleTransport: human-readable format (default)", () => {
  it("includes the timestamp, level, and message", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    void consoleTransport().log(record({ message: "post created" }));

    const [line] = spy.mock.calls[0] as [string];
    expect(line).toContain("2026-09-29T12:00:00.000Z");
    expect(line).toContain("INFO");
    expect(line).toContain("post created");

    spy.mockRestore();
  });

  it("appends non-empty context as trailing JSON", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    void consoleTransport().log(record({ context: { postId: "42" } }));

    const [line] = spy.mock.calls[0] as [string];
    expect(line).toContain('{"postId":"42"}');

    spy.mockRestore();
  });

  it("omits trailing JSON entirely when context is empty", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    void consoleTransport().log(record({ context: {} }));

    const [line] = spy.mock.calls[0] as [string];
    expect(line).not.toContain("{}");

    spy.mockRestore();
  });
});

describe("consoleTransport: json format", () => {
  it("writes the whole record as one JSON line", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    void consoleTransport({ json: true }).log(record({ context: { postId: "42" } }));

    const [line] = spy.mock.calls[0] as [string];
    expect(JSON.parse(line)).toEqual(record({ context: { postId: "42" } }));

    spy.mockRestore();
  });
});

describe("consoleTransport: minLevel", () => {
  it("passes minLevel through onto the returned transport", () => {
    expect(consoleTransport({ minLevel: "warn" }).minLevel).toBe("warn");
  });

  it("defaults to no minLevel override (everything passes through)", () => {
    expect(consoleTransport().minLevel).toBeUndefined();
  });
});

const lineOf = (spy: ReturnType<typeof vi.spyOn>): string => String(spy.mock.calls[0]?.[0]);

describe("consoleTransport: values JSON.stringify can't handle", () => {
  it("writes an Error's message and stack, not {}", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    void consoleTransport().log(record({ level: "error", message: "failed", context: { error: new Error("connection refused") } }));

    expect(lineOf(spy)).toContain("connection refused");
    expect(lineOf(spy)).toContain("Error: connection refused");
    expect(lineOf(spy)).not.toContain('"error":{}');
    spy.mockRestore();
  });

  it("does the same in json mode", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    void consoleTransport({ json: true }).log(record({ level: "error", message: "failed", context: { error: new Error("connection refused") } }));

    const parsed = JSON.parse(lineOf(spy)) as { message: string; context: { error: { message: string; name: string } } };
    expect(parsed.message).toBe("failed");
    expect(parsed.context.error).toMatchObject({ name: "Error", message: "connection refused" });
    spy.mockRestore();
  });

  it("still writes the line when the context is circular, instead of dropping it", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const context: Record<string, unknown> = { id: 7 };
    context["self"] = context;

    void consoleTransport().log(record({ message: "cyclic", context }));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(lineOf(spy)).toContain("cyclic");
    expect(lineOf(spy)).toContain("[Circular]");
    spy.mockRestore();
  });

  it("writes a BigInt", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    void consoleTransport().log(record({ context: { id: 9007199254740993n } }));

    expect(lineOf(spy)).toContain('"id":"9007199254740993"');
    spy.mockRestore();
  });
});
