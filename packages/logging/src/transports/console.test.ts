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
