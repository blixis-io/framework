import { Module } from "@blixis-io/core";
import { describe, expect, it } from "vitest";
import { Controller } from "./decorators/controller.js";
import { Get } from "./decorators/routes.js";
import { createHttpApplication, type Middleware } from "./http-application.js";
import { currentRemoteAddress } from "./remote-address.js";

@Controller("who")
class WhoController {
  @Get()
  who() {
    return { address: currentRemoteAddress() ?? null };
  }
}

@Module({ controllers: [WhoController] })
class AppModule {}

const seen: Array<string | undefined> = [];
const record: Middleware = (_request, next) => {
  seen.push(currentRemoteAddress());
  return next();
};

const replaceRequest: Middleware = (request, next) => next(new Request(request, { headers: { "x-extra": "1" } }));

describe("currentRemoteAddress()", () => {
  it("is the loopback peer for a request that arrived on a real socket, in the controller", async () => {
    const app = await createHttpApplication(AppModule);
    const { port } = await app.listen(0, "127.0.0.1");

    const body = await (await fetch(`http://127.0.0.1:${port}/who`)).json();

    expect(body).toEqual({ address: "127.0.0.1" });
    await app.close();
  });

  it("is visible to a middleware, before and after next(), and to the controller", async () => {
    seen.length = 0;
    const app = await createHttpApplication(AppModule, { middleware: [record] });
    const { port } = await app.listen(0, "127.0.0.1");

    const body = await (await fetch(`http://127.0.0.1:${port}/who`)).json();

    expect(seen).toEqual(["127.0.0.1"]);
    expect(body).toEqual({ address: "127.0.0.1" });
    await app.close();
  });

  it("survives a middleware handing on a changed Request", async () => {
    const app = await createHttpApplication(AppModule, { middleware: [replaceRequest] });
    const { port } = await app.listen(0, "127.0.0.1");

    const body = await (await fetch(`http://127.0.0.1:${port}/who`)).json();

    expect(body).toEqual({ address: "127.0.0.1" });
    await app.close();
  });

  it("is also there for a 404 the router answers, seen by a middleware", async () => {
    seen.length = 0;
    const app = await createHttpApplication(AppModule, { middleware: [record] });
    const { port } = await app.listen(0, "127.0.0.1");

    expect((await fetch(`http://127.0.0.1:${port}/nowhere`)).status).toBe(404);

    expect(seen).toEqual(["127.0.0.1"]);
    await app.close();
  });

  it("is undefined for a request handled in-process, which has no peer", async () => {
    const app = await createHttpApplication(AppModule);

    const body = await (await app.handle(new Request("http://localhost/who"))).json();

    expect(body).toEqual({ address: null });
    await app.close();
  });

  it("is undefined outside any request", () => {
    expect(currentRemoteAddress()).toBeUndefined();
  });

  it("is never taken from a header a client sends", async () => {
    const app = await createHttpApplication(AppModule, { trustProxy: true, trustHostHeader: true });
    const { port } = await app.listen(0, "127.0.0.1");

    const response = await fetch(`http://127.0.0.1:${port}/who`, { headers: { "x-forwarded-for": "198.51.100.9", forwarded: "for=198.51.100.9" } });

    expect(await response.json()).toEqual({ address: "127.0.0.1" });
    await app.close();
  });
});
