import { Module } from "@blixis-io/core";
import { describe, expect, it, vi } from "vitest";
import { accessLog, type AccessLogEntry } from "./access-log.js";
import { Controller } from "./decorators/controller.js";
import { Get } from "./decorators/routes.js";
import type { ErrorReport } from "./error-report.js";
import { NotFoundException } from "./exceptions.js";
import { createFetchHandler } from "./fetch-handler.js";
import { createHttpApplication, type Middleware } from "./http-application.js";
import { currentRequestId, requestId, withResponseHeaders } from "./request-id.js";

@Controller("things")
class ThingsController {
  @Get()
  list() {
    return { requestId: currentRequestId() ?? null };
  }

  @Get("boom")
  boom(): never {
    throw new Error("database password is hunter2");
  }

  @Get("missing")
  missing(): never {
    throw new NotFoundException();
  }

  @Get("redirect")
  redirect() {
    return Response.redirect("http://localhost/things", 302);
  }
}

@Module({ controllers: [ThingsController] })
class AppModule {}

const get = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

const throwOnPath: Middleware = (request, next) => {
  if (new URL(request.url).pathname === "/from-middleware") {
    throw new Error("middleware failed");
  }
  return next();
};

describe("onError", () => {
  it("receives an unexpected controller error with the request, the route and the request id, and the client gets a generic 500", async () => {
    const reports: ErrorReport[] = [];
    const app = await createHttpApplication(AppModule, {
      middleware: [requestId({ generate: () => "req-1" })],
      onError: (report) => reports.push(report),
    });

    const response = await app.handle(get("/things/boom?token=abc"));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("hunter2");
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      phase: "request",
      requestId: "req-1",
      route: { controller: ThingsController, handler: "boom" },
    });
    expect(reports[0]?.error).toMatchObject({ message: "database password is hunter2" });
    expect(reports[0]?.request?.url).toBe("http://localhost/things/boom?token=abc");
    await app.close();
  });

  it("is not called for an HttpException, which is an answer and not an error", async () => {
    const onError = vi.fn<(report: ErrorReport) => void>();
    const app = await createHttpApplication(AppModule, { onError });

    expect((await app.handle(get("/things/missing"))).status).toBe(404);

    expect(onError).not.toHaveBeenCalled();
    await app.close();
  });

  it("receives an error a middleware threw, and one from a mounted handler, with no route", async () => {
    const reports: ErrorReport[] = [];
    const app = await createHttpApplication(AppModule, { middleware: [throwOnPath], onError: (report) => reports.push(report) });
    app.mount("GET", "/mounted", () => {
      throw new Error("mounted failed");
    });

    await app.handle(get("/from-middleware"));
    await app.handle(get("/mounted"));

    expect(reports.map((report) => [report.phase, report.error instanceof Error ? report.error.message : report.error, report.route])).toEqual([
      ["request", "middleware failed", undefined],
      ["request", "mounted failed", undefined],
    ]);
    await app.close();
  });

  it("is told about a boot failure under createFetchHandler, and the client still gets a generic 500", async () => {
    const reports: ErrorReport[] = [];

    @Controller("dup")
    class Duplicate {
      @Get("x")
      first() {
        return 1;
      }

      @Get("x")
      second() {
        return 2;
      }
    }

    @Module({ controllers: [Duplicate] })
    class BrokenModule {}

    const handler = createFetchHandler(BrokenModule, { onError: (report) => reports.push(report) });

    const response = await handler.fetch(get("/dup/x"));

    expect(response.status).toBe(500);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ phase: "boot" });
  });

  it("writes to console.error, the error first, when no onError is given", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await createHttpApplication(AppModule);

    await app.handle(get("/things/boom"));

    expect(error.mock.calls[0]?.[0]).toMatchObject({ message: "database password is hunter2" });
    error.mockRestore();
    await app.close();
  });

  it("survives an onError that throws: the client still gets its 500 and both failures are written", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await createHttpApplication(AppModule, {
      onError: () => {
        throw new Error("logger is down");
      },
    });

    const response = await app.handle(get("/things/boom"));

    expect(response.status).toBe(500);
    const written = error.mock.calls.flat().map((entry) => (entry instanceof Error ? entry.message : String(entry)));
    expect(written).toEqual(expect.arrayContaining(["logger is down", "database password is hunter2"]));
    error.mockRestore();
    await app.close();
  });
});

describe("requestId()", () => {
  it("makes an id for a request without one, shares it with the controller and sets it on the response", async () => {
    const app = await createHttpApplication(AppModule, { middleware: [requestId({ generate: () => "generated-1" })] });

    const response = await app.handle(get("/things"));

    expect(response.headers.get("x-request-id")).toBe("generated-1");
    expect(await response.json()).toEqual({ requestId: "generated-1" });
    await app.close();
  });

  it("keeps an acceptable id the client sent", async () => {
    const app = await createHttpApplication(AppModule, { middleware: [requestId({ generate: () => "generated" })] });

    const response = await app.handle(get("/things", { headers: { "x-request-id": "client-42_a.b:c" } }));

    expect(response.headers.get("x-request-id")).toBe("client-42_a.b:c");
    expect(await response.json()).toEqual({ requestId: "client-42_a.b:c" });
    await app.close();
  });

  it.each([["has spaces in it"], ["a".repeat(129)], ["has\ttab"], ["<script>"]])("replaces an id that is not a short token (%s)", async (bad) => {
    const app = await createHttpApplication(AppModule, { middleware: [requestId({ generate: () => "generated" })] });

    const response = await app.handle(get("/things", { headers: { "x-request-id": bad } }));

    expect(response.headers.get("x-request-id")).toBe("generated");
    await app.close();
  });

  it("ignores the client's id when trustIncoming is off", async () => {
    const app = await createHttpApplication(AppModule, { middleware: [requestId({ trustIncoming: false, generate: () => "generated" })] });

    const response = await app.handle(get("/things", { headers: { "x-request-id": "client-1" } }));

    expect(response.headers.get("x-request-id")).toBe("generated");
    await app.close();
  });

  it("uses another header when asked, and gives every request its own id", async () => {
    let counter = 0;
    const app = await createHttpApplication(AppModule, { middleware: [requestId({ header: "x-trace-id", generate: () => `id-${++counter}` })] });

    const ids = await Promise.all([0, 1, 2].map(async () => (await app.handle(get("/things"))).headers.get("x-trace-id")));

    expect([...ids].toSorted((a, b) => String(a).localeCompare(String(b)))).toEqual(["id-1", "id-2", "id-3"]);
    await app.close();
  });

  it("sets the id on responses the router and the guards produce, and on a response with immutable headers", async () => {
    const app = await createHttpApplication(AppModule, { middleware: [requestId({ generate: () => "generated" })] });

    expect((await app.handle(get("/nowhere"))).headers.get("x-request-id")).toBe("generated");
    const redirect = await app.handle(get("/things/redirect"));
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("x-request-id")).toBe("generated");
    expect(redirect.headers.get("location")).toBe("http://localhost/things");
    await app.close();
  });

  it("has no id outside a request", () => {
    expect(currentRequestId()).toBeUndefined();
  });
});

describe("withResponseHeaders()", () => {
  it("sets headers in place when it can", () => {
    const response = new Response("x");

    expect(withResponseHeaders(response, { "x-a": "1" })).toBe(response);
    expect(response.headers.get("x-a")).toBe("1");
  });

  it("returns a copy, keeping status, body and headers, when the headers are immutable", async () => {
    const original = Response.redirect("http://localhost/x", 301);

    const result = withResponseHeaders(original, { "x-a": "1" });

    expect(result).not.toBe(original);
    expect([result.status, result.headers.get("location"), result.headers.get("x-a")]).toEqual([301, "http://localhost/x", "1"]);
  });
});

async function appWithLog(entries: AccessLogEntry[], extra: Middleware[] = []) {
  return createHttpApplication(AppModule, {
    middleware: [requestId({ generate: () => "req-7" }), accessLog({ log: (entry) => entries.push(entry) }), ...extra],
    requestTimeout: 1000,
  });
}

describe("accessLog()", () => {
  it("writes one entry per request, for every kind of response, without the query string", async () => {
    const entries: AccessLogEntry[] = [];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await appWithLog(entries);

    await app.handle(get("/things?token=secret"));
    await app.handle(get("/nowhere"));
    await app.handle(get("/things", { method: "DELETE" }));
    await app.handle(get("/things/boom"));

    expect(entries.map((entry) => [entry.method, entry.path, entry.status, entry.requestId])).toEqual([
      ["GET", "/things", 200, "req-7"],
      ["GET", "/nowhere", 404, "req-7"],
      ["DELETE", "/things", 405, "req-7"],
      ["GET", "/things/boom", 500, "req-7"],
    ]);
    expect(JSON.stringify(entries)).not.toContain("secret");
    expect(entries.every((entry) => entry.durationMs >= 0)).toBe(true);
    error.mockRestore();
    await app.close();
  });

  it("leaves the request id out when requestId() is not in use", async () => {
    const entries: AccessLogEntry[] = [];
    const app = await createHttpApplication(AppModule, { middleware: [accessLog({ log: (entry) => entries.push(entry) })] });

    await app.handle(get("/things"));

    expect(entries[0]).not.toHaveProperty("requestId");
    await app.close();
  });

  it("logs a 500 when a middleware further in throws", async () => {
    const entries: AccessLogEntry[] = [];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await appWithLog(entries, [
      () => {
        throw new Error("later middleware failed");
      },
    ]);

    const response = await app.handle(get("/things"));

    expect(response.status).toBe(500);
    expect(entries.map((entry) => entry.status)).toEqual([500]);
    error.mockRestore();
    await app.close();
  });

  it("never fails a request because the log function threw", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await createHttpApplication(AppModule, {
      middleware: [
        accessLog({
          log: () => {
            throw new Error("disk full");
          },
        }),
      ],
    });

    expect((await app.handle(get("/things"))).status).toBe(200);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    await app.close();
  });

  it("carries the same request id as the error report for the same failing request", async () => {
    const entries: AccessLogEntry[] = [];
    const reports: ErrorReport[] = [];
    const app = await createHttpApplication(AppModule, {
      middleware: [requestId({ generate: () => "req-9" }), accessLog({ log: (entry) => entries.push(entry) })],
      onError: (report) => reports.push(report),
    });

    await app.handle(get("/things/boom"));

    expect(entries[0]?.requestId).toBe("req-9");
    expect(reports[0]?.requestId).toBe("req-9");
    await app.close();
  });
});
