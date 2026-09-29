import { Body, Controller, createHttpApplication, Get, Param, Post } from "@blixis/http";
import { Module } from "@blixis/core";
import { Injectable } from "@blixis/di";
import { describe, expect, it } from "vitest";
import { TestApplication } from "./test-application.js";

@Injectable()
class EchoService {
  echo(value: string): string {
    return value;
  }
}

@Controller("echo")
class EchoController {
  constructor(private readonly service: EchoService) {}

  @Get(":value")
  get(@Param("value") value: string) {
    return { value: this.service.echo(value) };
  }

  @Post()
  post(@Body() body: unknown) {
    return { received: body };
  }
}

@Module({ providers: [EchoService], controllers: [EchoController] })
class EchoModule {}

describe("TestApplication.request", () => {
  it("builds an absolute URL from a bare path and returns the Response", async () => {
    const app = new TestApplication(await createHttpApplication(EchoModule));

    const res = await app.request("/echo/hi");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ value: "hi" });

    await app.close();
  });

  it("JSON-encodes `json` into the body and sets the content-type header", async () => {
    const app = new TestApplication(await createHttpApplication(EchoModule));

    const res = await app.request("/echo", { method: "POST", json: { a: 1 } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: { a: 1 } });

    await app.close();
  });

  it("exposes get() to fetch a resolved provider directly", async () => {
    const app = new TestApplication(await createHttpApplication(EchoModule));

    expect(app.get(EchoService)).toBeInstanceOf(EchoService);

    await app.close();
  });
});
