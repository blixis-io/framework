import { z } from "zod";
import { describe, expect, it } from "vitest";
import { BadRequestException } from "./exceptions.js";
import { resolveHandlerArgs } from "./params.js";
import type { ParamSource } from "./decorators/params.js";

function context(overrides: Partial<Parameters<typeof resolveHandlerArgs>[1]> = {}) {
  return {
    request: new Request("http://localhost/posts/42?limit=10"),
    routeParams: { id: "42" },
    getBody: () => Promise.resolve(undefined),
    ...overrides,
  };
}

describe("resolveHandlerArgs", () => {
  it("returns an empty array when there are no param sources", async () => {
    expect(await resolveHandlerArgs(new Map(), context())).toEqual([]);
  });

  it("resolves @Req to the raw Request", async () => {
    const ctx = context();
    const sources = new Map<number, ParamSource>([[0, { kind: "req" }]]);

    const args = await resolveHandlerArgs(sources, ctx);

    expect(args[0]).toBe(ctx.request);
  });

  it("resolves @Headers(name) to one header value, and @Headers() to all headers", async () => {
    const ctx = context({
      request: new Request("http://localhost/", { headers: { "x-trace": "abc" } }),
    });
    const sources = new Map<number, ParamSource>([
      [0, { kind: "headers", name: "x-trace" }],
      [1, { kind: "headers" }],
    ]);

    const args = await resolveHandlerArgs(sources, ctx);

    expect(args[0]).toBe("abc");
    expect(args[1]).toMatchObject({ "x-trace": "abc" });
  });

  it("resolves @Param(name) to the raw route param when no schema is given", async () => {
    const sources = new Map<number, ParamSource>([[0, { kind: "param", name: "id" }]]);

    expect(await resolveHandlerArgs(sources, context())).toEqual(["42"]);
  });

  it("coerces @Param(name, schema) through the schema", async () => {
    const sources = new Map<number, ParamSource>([[0, { kind: "param", name: "id", schema: z.coerce.number() }]]);

    expect(await resolveHandlerArgs(sources, context())).toEqual([42]);
  });

  it("throws BadRequestException with issues when a param fails validation", async () => {
    const sources = new Map<number, ParamSource>([[0, { kind: "param", name: "id", schema: z.uuid() }]]);

    await expect(resolveHandlerArgs(sources, context())).rejects.toThrow(BadRequestException);
  });

  it("resolves @Query() to the parsed search params, validated when a schema is given", async () => {
    const sources = new Map<number, ParamSource>([
      [0, { kind: "query", schema: z.object({ limit: z.coerce.number() }) }],
    ]);

    expect(await resolveHandlerArgs(sources, context())).toEqual([{ limit: 10 }]);
  });

  it("resolves @Body(schema) through the provided getBody(), validated by the schema", async () => {
    const CreatePost = z.object({ title: z.string() });
    const ctx = context({ getBody: () => Promise.resolve({ title: "hi" }) });
    const sources = new Map<number, ParamSource>([[0, { kind: "body", schema: CreatePost }]]);

    expect(await resolveHandlerArgs(sources, ctx)).toEqual([{ title: "hi" }]);
  });

  it("propagates a getBody() rejection (e.g. 413/415 from the caller) without swallowing it", async () => {
    const boom = new BadRequestException("bad body");
    const ctx = context({ getBody: () => Promise.reject(boom) });
    const sources = new Map<number, ParamSource>([[0, { kind: "body" }]]);

    await expect(resolveHandlerArgs(sources, ctx)).rejects.toBe(boom);
  });

  it("resolves multiple params into their correct positions, leaving gaps as undefined", async () => {
    const sources = new Map<number, ParamSource>([
      [0, { kind: "param", name: "id" }],
      [2, { kind: "req" }],
    ]);

    const ctx = context();
    const args = await resolveHandlerArgs(sources, ctx);

    expect(args).toEqual(["42", undefined, ctx.request]);
  });
});
