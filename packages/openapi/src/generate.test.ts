import { Module } from "@blixis-io/core";
import { ApiOperation, ApiTags, Body, Controller, createHttpApplication, Delete, Get, Headers, HttpCode, Param, Post, Query, Returns } from "@blixis-io/http";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generateOpenApiDocument, serveOpenApi } from "./generate.js";

const PostSchema = z.object({ id: z.string(), title: z.string() });
const CreatePostSchema = z.object({ title: z.string() });
const QuerySchema = z.object({ page: z.coerce.number().optional(), q: z.string() });

@ApiTags("posts")
@Controller("posts")
class PostsController {
  @Get()
  @Returns(z.array(PostSchema))
  list(@Query(QuerySchema) _query: unknown) {
    return [];
  }

  @Get(":id")
  @Returns(PostSchema)
  get(@Param("id") _id: string, @Headers("x-request-id") _requestId: string) {
    return {};
  }

  @Post()
  @HttpCode(201)
  @Returns(PostSchema)
  @ApiOperation({ summary: "Create a post", operationId: "createPost" })
  create(@Body(CreatePostSchema) _input: unknown) {
    return {};
  }

  @ApiTags("admin")
  @Delete(":id")
  remove(@Param("id") _id: string): undefined {
    return undefined;
  }

  @Get("*")
  serve(@Param("*") _path: string) {
    return null;
  }
}

@Controller("misc")
class MiscController {
  @Get(":id")
  paramWithSchema(@Param("id", z.string().min(1)) _id: string) {
    return {};
  }

  @Get("search")
  noSchemaQuery(@Query() _query: unknown) {
    return {};
  }

  @Get("ping")
  bareHeaders(@Headers() _headers: unknown) {
    return {};
  }

  @Post("raw")
  @ApiOperation({ description: "Accepts anything" })
  bareBody(@Body() _input: unknown) {
    return {};
  }
}

class NoPrefixController {
  @Get("only")
  route() {
    return {};
  }
}

const doc = generateOpenApiDocument(
  { controllers: [PostsController, MiscController] },
  { title: "hello-api", version: "1.0.0", description: "Test API" },
);

describe("generateOpenApiDocument", () => {
  it("sets the document envelope", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info).toEqual({ title: "hello-api", version: "1.0.0", description: "Test API" });
  });

  it("omits description when not given", () => {
    const bare = generateOpenApiDocument({ controllers: [] }, { title: "x", version: "1.0.0" });
    expect(bare.info).toEqual({ title: "x", version: "1.0.0" });
  });

  it("builds a static path with the controller prefix", () => {
    expect(doc.paths["/posts"]).toBeDefined();
  });

  it("converts :param path segments to OpenAPI's {param} syntax", () => {
    expect(doc.paths["/posts/{id}"]).toBeDefined();
    expect(doc.paths["/posts/{id}"]?.get).toBeDefined();
    expect(doc.paths["/posts/{id}"]?.delete).toBeDefined();
  });

  it("falls back to no prefix for a controller-shaped class missing @Controller (defensive — real HttpApplication.controllers never contains one)", () => {
    const noPrefixDoc = generateOpenApiDocument(
      { controllers: [NoPrefixController] },
      { title: "x", version: "1.0.0" },
    );
    expect(noPrefixDoc.paths["/only"]).toBeDefined();
  });

  it("excludes wildcard (*) routes entirely", () => {
    for (const path of Object.keys(doc.paths)) {
      expect(path).not.toContain("*");
    }
    expect(Object.keys(doc.paths)).toHaveLength(6); // /posts, /posts/{id}, /misc/{id}, /misc/search, /misc/ping, /misc/raw
  });

  it("maps the HTTP method to a lowercase OpenAPI operation key", () => {
    expect(doc.paths["/posts"]?.get).toBeDefined();
    expect(doc.paths["/posts"]?.post).toBeDefined();
  });

  describe("parameters", () => {
    it("documents a schema-less @Param as a required path parameter typed as a bare string", () => {
      const params = doc.paths["/posts/{id}"]?.get?.parameters ?? [];
      const idParam = params.find((p) => p.name === "id");
      expect(idParam).toEqual({ name: "id", in: "path", required: true, schema: { type: "string" } });
    });

    it("uses the given schema for a @Param that has one", () => {
      const params = doc.paths["/misc/{id}"]?.get?.parameters ?? [];
      const idParam = params.find((p) => p.name === "id");
      expect(idParam).toEqual({ name: "id", in: "path", required: true, schema: { type: "string", minLength: 1 } });
    });

    it("documents each key of a ZodObject @Query schema as its own parameter, required following isOptional", () => {
      const params = doc.paths["/posts"]?.get?.parameters ?? [];
      const page = params.find((p) => p.name === "page");
      const q = params.find((p) => p.name === "q");
      expect(page).toEqual({ name: "page", in: "query", required: false, schema: { type: "number" } });
      expect(q).toEqual({ name: "q", in: "query", required: true, schema: { type: "string" } });
    });

    it("documents nothing for a @Query with no ZodObject schema", () => {
      expect(doc.paths["/misc/search"]?.get?.parameters).toBeUndefined();
    });

    it("documents a named @Headers param, not an unnamed one", () => {
      const params = doc.paths["/posts/{id}"]?.get?.parameters ?? [];
      const header = params.find((p) => p.in === "header");
      expect(header).toEqual({ name: "x-request-id", in: "header", required: false, schema: { type: "string" } });
    });

    it("documents nothing for an unnamed @Headers()", () => {
      expect(doc.paths["/misc/ping"]?.get?.parameters).toBeUndefined();
    });

    it("has no parameters for a route with none", () => {
      expect(doc.paths["/posts"]?.post?.parameters).toBeUndefined();
    });
  });

  describe("requestBody", () => {
    it("documents a @Body schema as the JSON request body", () => {
      expect(doc.paths["/posts"]?.post?.requestBody).toEqual({
        required: true,
        content: { "application/json": { schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false } } },
      });
    });

    it("has no requestBody for a route with no @Body", () => {
      expect(doc.paths["/posts/{id}"]?.get?.requestBody).toBeUndefined();
    });

    it("has no requestBody for a schema-less @Body() either — nothing to document", () => {
      expect(doc.paths["/misc/raw"]?.post?.requestBody).toBeUndefined();
    });
  });

  describe("responses", () => {
    it("documents the @Returns schema at the default 200 status", () => {
      const responses = doc.paths["/posts/{id}"]?.get?.responses;
      expect(responses?.["200"]).toEqual({
        description: "Success",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { id: { type: "string" }, title: { type: "string" } },
              required: ["id", "title"],
              additionalProperties: false,
            },
          },
        },
      });
    });

    it("uses @HttpCode's status instead of 200 when set", () => {
      const responses = doc.paths["/posts"]?.post?.responses;
      expect(responses?.["201"]).toBeDefined();
      expect(responses?.["200"]).toBeUndefined();
    });

    it("documents a bare success status with no schema when there's no @Returns", () => {
      const responses = doc.paths["/posts/{id}"]?.delete?.responses;
      expect(responses?.["200"]).toEqual({ description: "Success" });
    });

    it("adds a default response referencing the shared Problem schema on every operation", () => {
      for (const pathItem of Object.values(doc.paths)) {
        for (const operation of Object.values(pathItem)) {
          expect(operation.responses["default"]).toEqual({
            description: "Error",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Problem" } } },
          });
        }
      }
    });
  });

  describe("components", () => {
    it("defines the Problem schema once, matching handler.ts's problemResponse shape", () => {
      expect(doc.components.schemas["Problem"]).toEqual({
        type: "object",
        properties: {
          type: { type: "string" },
          title: { type: "string" },
          status: { type: "integer" },
          detail: { type: "string" },
        },
        required: ["type", "title", "status", "detail"],
      });
    });
  });

  describe("operationId, summary, description, tags", () => {
    it("uses the explicit operationId and summary from @ApiOperation when given", () => {
      const op = doc.paths["/posts"]?.post;
      expect(op?.operationId).toBe("createPost");
      expect(op?.summary).toBe("Create a post");
    });

    it("derives operationId from the controller and method name when @ApiOperation is absent", () => {
      const op = doc.paths["/posts"]?.get;
      expect(op?.operationId).toBe("PostsController_list");
    });

    it("omits summary/description when @ApiOperation doesn't set them", () => {
      const op = doc.paths["/posts"]?.get;
      expect(op?.summary).toBeUndefined();
      expect(op?.description).toBeUndefined();
    });

    it("uses @ApiOperation's description when given", () => {
      expect(doc.paths["/misc/raw"]?.post?.description).toBe("Accepts anything");
    });

    it("concatenates class-level and method-level tags", () => {
      expect(doc.paths["/posts/{id}"]?.delete?.tags).toEqual(["posts", "admin"]);
    });

    it("uses just the class-level tag when no method-level tag is set", () => {
      expect(doc.paths["/posts"]?.get?.tags).toEqual(["posts"]);
    });

    it("omits tags entirely for an operation with none", () => {
      const bareController = (() => {
        @Controller("bare")
        class Bare {
          @Get()
          list() {
            return [];
          }
        }
        return Bare;
      })();
      const bareDoc = generateOpenApiDocument({ controllers: [bareController] }, { title: "x", version: "1.0.0" });
      expect(bareDoc.paths["/bare"]?.get?.tags).toBeUndefined();
    });
  });
});

describe("serveOpenApi", () => {
  @Controller("ping")
  class PingController {
    @Get()
    ping() {
      return { ok: true };
    }
  }

  @Module({ controllers: [PingController] })
  class PingModule {}

  it("serves the generated document at the given path of a real HttpApplication", async () => {
    const app = await createHttpApplication(PingModule);
    serveOpenApi(app, "/openapi.json", { title: "ping-api", version: "1.0.0" });

    const res = await app.handle(new Request("http://localhost/openapi.json"));

    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toMatchObject({ info: { title: "ping-api" }, paths: { "/ping": {} } });
    await app.close();
  });

  it("keeps routing the app's own routes", async () => {
    const app = await createHttpApplication(PingModule);
    serveOpenApi(app, "/openapi.json", { title: "ping-api", version: "1.0.0" });

    const res = await app.handle(new Request("http://localhost/ping"));

    expect(await res.json()).toEqual({ ok: true });
    await app.close();
  });
});
