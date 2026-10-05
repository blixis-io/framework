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

describe("createLogger: redact", () => {
  it("hands every transport a context with the listed keys redacted", () => {
    const first = recordingTransport();
    const second = recordingTransport();
    const logger = createLogger({ transports: [first.transport, second.transport], redact: ["password", "authorization"] });

    logger.info("login", { user: "ada", password: "hunter2", headers: { Authorization: "Bearer abc", accept: "json" } });

    for (const { records } of [first, second]) {
      expect(records[0]?.context).toEqual({ user: "ada", password: "[REDACTED]", headers: { Authorization: "[REDACTED]", accept: "json" } });
    }
  });

  it("redacts what a child logger bound, as well as what each call adds", () => {
    const { transport, records } = recordingTransport();
    const logger = createLogger({ transports: [transport], redact: ["token"] }).child({ token: "bound-secret", service: "api" });

    logger.info("x", { requestId: "r1" });

    expect(records[0]?.context).toEqual({ token: "[REDACTED]", service: "api", requestId: "r1" });
  });

  it("redacts inside an attached error, which is written out as plain data when redaction is on", () => {
    const { transport, records } = recordingTransport();
    const logger = createLogger({ transports: [transport], redact: ["password"] });

    logger.error("failed", { error: Object.assign(new Error("db rejected"), { password: "p" }) });

    expect(records[0]?.context).toMatchObject({ error: { message: "db rejected", password: "[REDACTED]" } });
  });

  it("leaves the caller's own object untouched", () => {
    const { transport } = recordingTransport();
    const logger = createLogger({ transports: [transport], redact: ["password"] });
    const context = { password: "hunter2" };

    logger.info("x", context);

    expect(context.password).toBe("hunter2");
  });

  it("passes the context through as given when no redact list is set, errors included", () => {
    const { transport, records } = recordingTransport();
    const logger = createLogger({ transports: [transport] });
    const error = new Error("kept as an Error");

    logger.error("x", { error });

    expect(records[0]?.context["error"]).toBe(error);
  });
});

/** An object whose property reads are counted: spreading it into a merged context reads every one. */
function watched() {
  const reads = { count: 0 };
  const context = {
    get expensive(): string {
      reads.count += 1;
      return "value";
    },
  };
  return { context, reads };
}

describe("createLogger: no work for a level nothing will receive", () => {
  it("does not touch the context of a call below the logger's minLevel", () => {
    const { transport } = recordingTransport();
    const { context, reads } = watched();
    const logger = createLogger({ transports: [transport], minLevel: "info" });

    logger.debug("skipped", context);
    logger.trace("skipped", context);

    expect(reads.count).toBe(0);
  });

  it("does not touch it when every transport's own minLevel is above the call", () => {
    const { transport } = recordingTransport("error");
    const { context, reads } = watched();
    const logger = createLogger({ transports: [transport] });

    logger.info("skipped", context);
    logger.warn("skipped", context);

    expect(reads.count).toBe(0);
  });

  it("does not touch the bound context of a child either", () => {
    const { transport } = recordingTransport();
    const { context, reads } = watched();
    const child = createLogger({ transports: [transport], minLevel: "error" }).child(context);
    // child() merges its context once, when it is created; what matters is that logging below the level doesn't redo it.
    reads.count = 0;

    child.info("skipped");

    expect(reads.count).toBe(0);
  });

  it("still delivers a call at or above the level, and to the transport that wants it", () => {
    const quiet = recordingTransport("error");
    const loud = recordingTransport();
    const logger = createLogger({ transports: [quiet.transport, loud.transport] });

    logger.info("hello");
    logger.error("boom");

    expect(quiet.records.map((r) => r.message)).toEqual(["boom"]);
    expect(loud.records.map((r) => r.message)).toEqual(["hello", "boom"]);
  });

  it("with no transports there is nothing to do at any level", () => {
    const { context, reads } = watched();

    createLogger({ transports: [] }).error("x", context);

    expect(reads.count).toBe(0);
  });
});
