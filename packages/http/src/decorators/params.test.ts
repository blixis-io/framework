import { z } from "zod";
import { describe, expect, it } from "vitest";
import { Body, getParamSources, Headers, Param, Query, Req } from "./params.js";

describe("parameter decorators", () => {
  it("records one param source per decorated parameter, keyed by position", () => {
    const CreatePost = z.object({ title: z.string() });

    class Controller {
      handler(
        @Body(CreatePost) _body: unknown,
        @Query() _query: unknown,
        @Param("id") _id: string,
        @Headers("authorization") _auth: string | null,
        @Req() _req: Request,
      ): void {}
    }

    const sources = getParamSources(Controller.prototype, "handler");

    expect(sources.get(0)).toEqual({ kind: "body", schema: CreatePost });
    expect(sources.get(1)).toEqual({ kind: "query", schema: undefined });
    expect(sources.get(2)).toEqual({ kind: "param", name: "id", schema: undefined });
    expect(sources.get(3)).toEqual({ kind: "headers", name: "authorization" });
    expect(sources.get(4)).toEqual({ kind: "req" });
  });

  it("a method with no decorated parameters has an empty param source map", () => {
    class Controller {
      handler(): void {}
    }

    expect(getParamSources(Controller.prototype, "handler").size).toBe(0);
  });

  it("throws when applied to a constructor parameter instead of a method parameter", () => {
    class Controller {}

    expect(() => Req()(Controller, undefined, 0)).toThrow(
      "@Body/@Query/@Param/@Headers/@Req can only decorate route handler method parameters, not constructor parameters.",
    );
  });
});
