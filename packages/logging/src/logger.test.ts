import { describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger.js";
import type { LogRecord, Transport } from "./types.js";

function recordingTransport(minLevel?: Transport["minLevel"]) {
  const records: LogRecord[] = [];
  const transport: Transport = {
    minLevel,
    log: (record) => {
      records.push(record);
    },
  };
  return { transport, records };
}

describe("createLogger: basic logging", () => {
  it("calls the transport once per level method, with the right level and message", () => {
    const { transport, records } = recordingTransport();
    const logger = createLogger({ transports: [transport] });

    logger.trace("a");
    logger.debug("b");
    logger.info("c");
    logger.warn("d");
    logger.error("e");
    logger.fatal("f");

    expect(records.map((r) => [r.level, r.message])).toEqual([
      ["trace", "a"],
      ["debug", "b"],
      ["info", "c"],
      ["warn", "d"],
      ["error", "e"],
      ["fatal", "f"],
    ]);
  });

  it("stamps a valid ISO timestamp on every record", () => {
    const { transport, records } = recordingTransport();
    const logger = createLogger({ transports: [transport] });

    logger.info("hi");

    expect(records[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("passes the call-site context through", () => {
    const { transport, records } = recordingTransport();
    const logger = createLogger({ transports: [transport] });

    logger.info("saved", { postId: "42" });

    expect(records[0]?.context).toEqual({ postId: "42" });
  });

  it("defaults context to an empty object when none is given", () => {
    const { transport, records } = recordingTransport();
    const logger = createLogger({ transports: [transport] });

    logger.info("hi");

    expect(records[0]?.context).toEqual({});
  });
});

describe("createLogger: level filtering", () => {
  it("the global minLevel suppresses lower-severity calls entirely", () => {
    const { transport, records } = recordingTransport();
    const logger = createLogger({ transports: [transport], minLevel: "warn" });

    logger.info("suppressed");
    logger.warn("kept");

    expect(records.map((r) => r.message)).toEqual(["kept"]);
  });

  it("a transport's own minLevel filters independently of the global one", () => {
    const { transport: everything, records: everythingRecords } = recordingTransport();
    const { transport: errorsOnly, records: errorRecords } = recordingTransport("error");
    const logger = createLogger({ transports: [everything, errorsOnly] });

    logger.info("info-level");
    logger.error("error-level");

    expect(everythingRecords.map((r) => r.message)).toEqual(["info-level", "error-level"]);
    expect(errorRecords.map((r) => r.message)).toEqual(["error-level"]);
  });
});

describe("createLogger: multiple transports", () => {
  it("fans out every entry to every (level-passing) transport", () => {
    const { transport: a, records: aRecords } = recordingTransport();
    const { transport: b, records: bRecords } = recordingTransport();
    const logger = createLogger({ transports: [a, b] });

    logger.info("hi");

    expect(aRecords).toHaveLength(1);
    expect(bRecords).toHaveLength(1);
  });
});

describe("createLogger: bound context and child()", () => {
  it("createLogger's own base context is merged into every entry", () => {
    const { transport, records } = recordingTransport();
    const logger = createLogger({ transports: [transport], context: { service: "hello-api" } });

    logger.info("hi", { postId: "1" });

    expect(records[0]?.context).toEqual({ service: "hello-api", postId: "1" });
  });

  it("child() merges its context on top of the parent's, without mutating the parent", () => {
    const { transport, records } = recordingTransport();
    const logger = createLogger({ transports: [transport], context: { service: "hello-api" } });
    const child = logger.child({ requestId: "abc" });

    child.info("in request");
    logger.info("outside request");

    expect(records[0]?.context).toEqual({ service: "hello-api", requestId: "abc" });
    expect(records[1]?.context).toEqual({ service: "hello-api" });
  });

  it("call-site context wins over bound context on key collision", () => {
    const { transport, records } = recordingTransport();
    const logger = createLogger({ transports: [transport], context: { postId: "bound" } });

    logger.info("hi", { postId: "call-site" });

    expect(records[0]?.context["postId"]).toBe("call-site");
  });
});

describe("createLogger: transport failure isolation", () => {
  it("a transport that throws synchronously does not stop other transports or the caller", () => {
    const throwing: Transport = {
      log: () => {
        throw new Error("transport boom");
      },
    };
    const { transport: healthy, records } = recordingTransport();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const logger = createLogger({ transports: [throwing, healthy] });

    expect(() => logger.info("hi")).not.toThrow();
    expect(records).toHaveLength(1);
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("a transport that rejects asynchronously is reported, not an unhandled rejection", async () => {
    const rejecting: Transport = {
      log: () => Promise.reject(new Error("network boom")),
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger({ transports: [rejecting] });

    logger.error("hi");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
