import { createApplication } from "@blixis-io/core";
import { describe, expect, it, vi } from "vitest";
import { defineEventsModule } from "./module.js";

type TestEvents = {
  "thing.happened": { id: string };
  "other.thing": { value: number };
};

async function buildBus() {
  const { EventsModule, EVENT_BUS } = defineEventsModule<TestEvents>();
  const app = await createApplication(EventsModule.forRoot());
  return app.get(EVENT_BUS);
}

describe("InProcessEventBus", () => {
  it("calls a registered handler with the emitted payload", async () => {
    const bus = await buildBus();
    const handler = vi.fn<(payload: TestEvents["thing.happened"]) => void>();
    bus.on("thing.happened", handler);

    await bus.emit("thing.happened", { id: "1" });

    expect(handler).toHaveBeenCalledWith({ id: "1" });
  });

  it("calls every handler registered for the same event type", async () => {
    const bus = await buildBus();
    const first = vi.fn<(payload: TestEvents["thing.happened"]) => void>();
    const second = vi.fn<(payload: TestEvents["thing.happened"]) => void>();
    bus.on("thing.happened", first);
    bus.on("thing.happened", second);

    await bus.emit("thing.happened", { id: "1" });

    expect(first).toHaveBeenCalledWith({ id: "1" });
    expect(second).toHaveBeenCalledWith({ id: "1" });
  });

  it("never calls a handler registered for a different event type", async () => {
    const bus = await buildBus();
    const handler = vi.fn<(payload: TestEvents["other.thing"]) => void>();
    bus.on("other.thing", handler);

    await bus.emit("thing.happened", { id: "1" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("resolves cleanly when nothing is registered for the emitted type", async () => {
    const bus = await buildBus();

    await expect(bus.emit("thing.happened", { id: "1" })).resolves.toBeUndefined();
  });

  it("on() returns a function that unsubscribes just that handler", async () => {
    const bus = await buildBus();
    const staying = vi.fn<(payload: TestEvents["thing.happened"]) => void>();
    const leaving = vi.fn<(payload: TestEvents["thing.happened"]) => void>();
    bus.on("thing.happened", staying);
    const unsubscribe = bus.on("thing.happened", leaving);

    unsubscribe();
    await bus.emit("thing.happened", { id: "1" });

    expect(staying).toHaveBeenCalledWith({ id: "1" });
    expect(leaving).not.toHaveBeenCalled();
  });

  it("a throwing handler doesn't prevent sibling handlers from running or reject emit()", async () => {
    const bus = await buildBus();
    const sibling = vi.fn<(payload: TestEvents["thing.happened"]) => void>();
    bus.on("thing.happened", () => {
      throw new Error("handler blew up");
    });
    bus.on("thing.happened", sibling);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(bus.emit("thing.happened", { id: "1" })).resolves.toBeUndefined();

    expect(sibling).toHaveBeenCalledWith({ id: "1" });
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("thing.happened"), expect.any(Error));
    consoleError.mockRestore();
  });

  it("a rejecting async handler doesn't prevent sibling handlers from running or reject emit()", async () => {
    const bus = await buildBus();
    const sibling = vi.fn<(payload: TestEvents["thing.happened"]) => void>();
    bus.on("thing.happened", async () => {
      throw new Error("async handler blew up");
    });
    bus.on("thing.happened", sibling);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(bus.emit("thing.happened", { id: "1" })).resolves.toBeUndefined();

    expect(sibling).toHaveBeenCalledWith({ id: "1" });
    consoleError.mockRestore();
  });

  it("emit() resolves only after every handler — including slower async ones — has settled", async () => {
    const bus = await buildBus();
    const completed: string[] = [];
    bus.on("thing.happened", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      completed.push("slow");
    });
    bus.on("thing.happened", () => {
      completed.push("fast");
    });

    await bus.emit("thing.happened", { id: "1" });

    expect(completed).toContain("slow");
    expect(completed).toContain("fast");
  });

  it("defaults to a non-global module", () => {
    const { EventsModule } = defineEventsModule<TestEvents>();

    const dynamic = EventsModule.forRoot();

    expect(dynamic.global).toBe(false);
  });

  it("global: true makes EVENT_BUS visible without a direct import", () => {
    const { EventsModule } = defineEventsModule<TestEvents>();

    const dynamic = EventsModule.forRoot({ global: true });

    expect(dynamic.global).toBe(true);
  });

  it("each call to defineEventsModule produces its own distinct token", () => {
    const a = defineEventsModule<TestEvents>();
    const b = defineEventsModule<TestEvents>();

    expect(a.EVENT_BUS).not.toBe(b.EVENT_BUS);
  });
});

async function busWith(onHandlerError: Parameters<ReturnType<typeof defineEventsModule<TestEvents>>["EventsModule"]["forRoot"]>[0]) {
  const { EventsModule, EVENT_BUS } = defineEventsModule<TestEvents>();
  const app = await createApplication(EventsModule.forRoot(onHandlerError));
  return app.get(EVENT_BUS);
}

describe("InProcessEventBus: onHandlerError", () => {
  it("hands a failing handler's error, event type and payload to the hook, and keeps going", async () => {
    const failures: unknown[] = [];
    const bus = await busWith({ onHandlerError: (failure) => failures.push(failure) });
    const sibling = vi.fn<(payload: TestEvents["thing.happened"]) => void>();
    bus.on("thing.happened", () => {
      throw new Error("handler boom");
    });
    bus.on("thing.happened", sibling);

    await expect(bus.emit("thing.happened", { id: "7" })).resolves.toBeUndefined();

    expect(sibling).toHaveBeenCalledWith({ id: "7" });
    expect(failures).toEqual([{ type: "thing.happened", error: expect.objectContaining({ message: "handler boom" }), payload: { id: "7" } }]);
  });

  it("also reports a handler that rejects", async () => {
    const failures: unknown[] = [];
    const bus = await busWith({ onHandlerError: (failure) => failures.push(failure) });
    bus.on("thing.happened", () => Promise.reject(new Error("async boom")));

    await bus.emit("thing.happened", { id: "1" });

    expect(failures).toHaveLength(1);
  });

  it("does not write to console.error when a hook takes the failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bus = await busWith({ onHandlerError: () => {} });
    bus.on("thing.happened", () => {
      throw new Error("handler boom");
    });

    await bus.emit("thing.happened", { id: "1" });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("survives a hook that throws, writing both failures to console.error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bus = await busWith({
      onHandlerError: () => {
        throw new Error("logger is down");
      },
    });
    bus.on("thing.happened", () => {
      throw new Error("handler boom");
    });

    await expect(bus.emit("thing.happened", { id: "1" })).resolves.toBeUndefined();

    const written = consoleError.mock.calls.flat().map((entry) => (entry instanceof Error ? entry.message : String(entry)));
    expect(written).toEqual(expect.arrayContaining(["logger is down", "handler boom"]));
    consoleError.mockRestore();
  });
});
