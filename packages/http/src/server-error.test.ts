import { Module } from "@blixis-io/core";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Controller } from "./decorators/controller.js";
import { Get } from "./decorators/routes.js";
import type { ErrorReport } from "./error-report.js";

// The only way to make a listening Node server emit `error` on demand is to hold on to it, so `createServer` is wrapped.
const created: Server[] = [];
vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http")>();
  return {
    ...actual,
    createServer: (...args: Parameters<typeof actual.createServer>) => {
      const server = actual.createServer(...args);
      created.push(server);
      return server;
    },
  };
});

const { createHttpApplication } = await import("./http-application.js");

@Controller("ping")
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

@Module({ controllers: [PingController] })
class AppModule {}

afterEach(() => {
  created.length = 0;
});

describe("an error the HTTP server reports after it started", () => {
  it("goes to onError with phase server, the process stays up and the next request is served", async () => {
    const reports: ErrorReport[] = [];
    const app = await createHttpApplication(AppModule, { onError: (report) => reports.push(report) });
    const { port } = await app.listen(0, "127.0.0.1");

    // Without a listener, this throws out of emit() as an uncaught exception.
    expect(() => created[0]?.emit("error", Object.assign(new Error("EMFILE: too many open files"), { code: "EMFILE" }))).not.toThrow();

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ phase: "server", error: { code: "EMFILE" } });
    expect((await fetch(`http://127.0.0.1:${port}/ping`)).status).toBe(200);
    await app.close();
  });

  it("is written to console.error when there is no onError", async () => {
    const written = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await createHttpApplication(AppModule);
    await app.listen(0, "127.0.0.1");

    created[0]?.emit("error", new Error("socket exploded"));

    expect(String(written.mock.calls[0]?.[0])).toContain("the server reported an error");
    written.mockRestore();
    await app.close();
  });

  it("still rejects listen() for an error before it started, such as the port being taken", async () => {
    const first = await createHttpApplication(AppModule);
    const { port } = await first.listen(0, "127.0.0.1");
    const second = await createHttpApplication(AppModule);

    await expect(second.listen(port, "127.0.0.1")).rejects.toThrow(/EADDRINUSE/);
    await first.close();
    await second.close();
  });
});
