import { describe, expect, it } from "vitest";
import { call, field, startApp } from "./test-support.js";

// Its own file: it starts and closes applications, and each file gets its own module state.

describe("shutdown", () => {
  it("stops being ready the moment shutdown starts, while staying alive", async () => {
    const draining = await startApp();
    expect((await call(draining.app, "GET", "/readyz")).status).toBe(200);

    draining.app.startDraining();

    const ready = await call(draining.app, "GET", "/readyz");
    expect(ready.status).toBe(503);
    expect(field(ready.json, "status")).toBe("draining");
    expect((await call(draining.app, "GET", "/livez")).status).toBe(200);
    await draining.close();
  });

});
