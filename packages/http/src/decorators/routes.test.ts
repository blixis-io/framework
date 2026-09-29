import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Delete, Get, getHttpCode, getReturnsSchema, getRoutes, HttpCode, Patch, Post, Put, Returns } from "./routes.js";

describe("route method decorators", () => {
  it("records one route entry per decorated method, defaulting the path to empty", () => {
    class Controller {
      @Get()
      list(): void {}

      @Get(":id")
      get(): void {}

      @Post()
      create(): void {}

      @Put(":id")
      replace(): void {}

      @Patch(":id")
      update(): void {}

      @Delete(":id")
      remove(): void {}
    }

    const routes = getRoutes(Controller);

    expect(routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "GET", path: "", propertyKey: "list" }),
        expect.objectContaining({ method: "GET", path: ":id", propertyKey: "get" }),
        expect.objectContaining({ method: "POST", path: "", propertyKey: "create" }),
        expect.objectContaining({ method: "PUT", path: ":id", propertyKey: "replace" }),
        expect.objectContaining({ method: "PATCH", path: ":id", propertyKey: "update" }),
        expect.objectContaining({ method: "DELETE", path: ":id", propertyKey: "remove" }),
      ]),
    );
    expect(routes).toHaveLength(6);
  });

  it("a class with no route decorators has an empty route list", () => {
    class Plain {}

    expect(getRoutes(Plain)).toEqual([]);
  });
});

describe("@HttpCode", () => {
  it("records a per-method status code override", () => {
    class Controller {
      @Post()
      @HttpCode(201)
      create(): void {}
    }

    expect(getHttpCode(Controller.prototype, "create")).toBe(201);
  });

  it("a method without @HttpCode has no override recorded", () => {
    class Controller {
      @Get()
      list(): void {}
    }

    expect(getHttpCode(Controller.prototype, "list")).toBeUndefined();
  });
});

describe("@Returns", () => {
  it("records a per-method response schema", () => {
    const PostSchema = z.object({ id: z.string() });

    class Controller {
      @Get()
      @Returns(PostSchema)
      get(): void {}
    }

    expect(getReturnsSchema(Controller.prototype, "get")).toBe(PostSchema);
  });

  it("a method without @Returns has no schema recorded", () => {
    class Controller {
      @Get()
      list(): void {}
    }

    expect(getReturnsSchema(Controller.prototype, "list")).toBeUndefined();
  });
});
