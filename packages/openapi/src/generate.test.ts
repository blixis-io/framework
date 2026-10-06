import { Module } from "@blixis-io/core";
import { ApiOperation, ApiTags, Body, Controller, createHttpApplication, Delete, Get, Headers, HttpCode, Param, Post, Query, Returns } from "@blixis-io/http";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiSecurity, generateOpenApiDocument, serveOpenApi } from "./generate.js";

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
        // No `additionalProperties: false`: a plain z.object() accepts a request with extra keys (and strips them).
        content: { "application/json": { schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } } },
      });
    });

    it("says additionalProperties: false only when the schema is .strict(), which really rejects extra keys", () => {
      @Controller("strict")
      class StrictController {
        @Post()
        create(@Body(CreatePostSchema.strict()) _input: unknown) {
          return {};
        }
      }

      expect(bodySchemaOf(StrictController)).toMatchObject({ additionalProperties: false });
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
            content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
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

describe("generateOpenApiDocument: validate: false", () => {
  it("still documents the declared response schema", () => {
    @Controller("fast")
    class FastController {
      @Get()
      @Returns(z.object({ id: z.string() }), { validate: false })
      list() {
        return { id: "1" };
      }
    }

    const fastDoc = generateOpenApiDocument({ controllers: [FastController] }, { title: "t", version: "1" });

    expect(fastDoc.paths["/fast"]?.["get"]?.responses["200"]?.content?.["application/json"]?.schema).toMatchObject({
      type: "object",
      properties: { id: { type: "string" } },
    });
  });
});

const bodySchemaOf = (controller: new () => object) => generateOpenApiDocument({ controllers: [controller] }, { title: "t", version: "1" }).paths["/strict"]?.post?.requestBody?.content["application/json"].schema;

const docFor = (...controllers: (new () => object)[]) => generateOpenApiDocument({ controllers }, { title: "t", version: "1" });

/** The schema of a `GET`'s 200 response, or of a `POST`'s request body, at `path`. */
const okSchema = (document: ReturnType<typeof docFor>, path: string) => document.paths[path]?.get?.responses["200"]?.content?.["application/json"]?.schema;
const bodySchema = (document: ReturnType<typeof docFor>, path: string) => document.paths[path]?.post?.requestBody?.content["application/json"].schema;

describe("generateOpenApiDocument: schemas JSON Schema can't represent", () => {
  const Created = z.object({ id: z.string(), createdAt: z.date() });
  const Wrapped = z.object({ name: z.string(), length: z.string().transform((value) => value.length) });

  @Controller("events")
  class EventsController {
    @Get()
    @Returns(Created)
    list() {
      return {};
    }

    @Get("wrapped")
    @Returns(Wrapped)
    wrapped() {
      return {};
    }

    @Post()
    create(@Body(Wrapped) _body: unknown) {
      return {};
    }
  }

  @Controller("fine")
  class FineController {
    @Get()
    @Returns(PostSchema)
    list() {
      return {};
    }
  }

  it("documents a z.date() as a date-time string instead of failing the whole document", () => {
    const document = docFor(EventsController);

    expect(okSchema(document, "/events")).toMatchObject({ properties: { id: { type: "string" }, createdAt: { type: "string", format: "date-time" } } });
  });

  it("documents a .transform() output as an open schema, not an error", () => {
    expect(okSchema(docFor(EventsController), "/events/wrapped")).toMatchObject({ properties: { name: { type: "string" }, length: {} } });
  });

  it("documents a request body's transform by what the client sends (its input), not by what it becomes", () => {
    expect(bodySchema(docFor(EventsController), "/events")).toMatchObject({ properties: { name: { type: "string" }, length: { type: "string" } } });
  });

  it("keeps the rest of the document when one schema is awkward", () => {
    const document = docFor(EventsController, FineController);

    expect(Object.keys(document.paths).toSorted()).toEqual(["/events", "/events/wrapped", "/fine"]);
    expect(okSchema(document, "/fine")).toMatchObject({ properties: { id: { type: "string" } } });
  });

  it("still serves the document over HTTP, where it used to answer 500", async () => {
    @Module({ controllers: [EventsController, FineController] })
    class EventsModule {}
    const app = await createHttpApplication(EventsModule);
    serveOpenApi(app, "/openapi.json", { title: "t", version: "1" });

    const res = await app.handle(new Request("http://localhost/openapi.json"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ paths: { "/events": {}, "/fine": {} } });
    await app.close();
  });

  it("gives a schema that cannot be converted at all an open schema and says why, without losing the other operations", () => {
    // A schema whose conversion throws: its definition is computed on demand, and the computation fails.
    const broken = z.lazy((): z.ZodType => {
      throw new Error("definition could not be built");
    });

    @Controller("broken")
    class BrokenController {
      @Post()
      create(@Body(broken) _body: unknown) {
        return {};
      }
    }

    const document = docFor(BrokenController, FineController);

    const schema = bodySchema(document, "/broken");
    expect(Object.keys(schema ?? {})).toEqual(["description"]);
    expect(String(schema?.["description"])).toContain("could not be converted");
    expect(String(schema?.["description"])).toContain("definition could not be built");
    expect(okSchema(document, "/fine")).toMatchObject({ properties: { id: { type: "string" } } });
  });
});

describe("generateOpenApiDocument: request schemas describe what a client sends", () => {
  const Create = z.object({ title: z.string(), tags: z.array(z.string()).default([]), draft: z.boolean().default(false) });

  @Controller("drafts")
  class DraftsController {
    @Post()
    @Returns(Create)
    create(@Body(Create) _body: unknown) {
      return {};
    }
  }

  it("does not mark a field with a default as required in the request body", () => {
    const schema = bodySchema(docFor(DraftsController), "/drafts");

    expect(schema?.["required"]).toEqual(["title"]);
  });

  it("does mark it required in the response, where the default has been applied", () => {
    const response = docFor(DraftsController).paths["/drafts"]?.post?.responses["200"]?.content?.["application/json"]?.schema;

    expect(response?.["required"]).toEqual(expect.arrayContaining(["title", "tags", "draft"]));
  });
});

describe("generateOpenApiDocument: @Query schemas of any shape", () => {
  const Plain = z.object({ page: z.coerce.number().default(1), q: z.string().optional(), sort: z.enum(["asc", "desc"]) });
  const Refined = Plain.refine((value) => value.page > 0);
  const Transformed = Plain.transform((value) => ({ ...value, offset: (value.page - 1) * 10 }));
  const Strict = Plain.strict();

  @Controller("search")
  class SearchController {
    @Get("plain")
    plain(@Query(Plain) _q: unknown) {
      return {};
    }

    @Get("refined")
    refined(@Query(Refined) _q: unknown) {
      return {};
    }

    @Get("transformed")
    transformed(@Query(Transformed) _q: unknown) {
      return {};
    }

    @Get("strict")
    strict(@Query(Strict) _q: unknown) {
      return {};
    }
  }

  const params = (path: string) => docFor(SearchController).paths[path]?.get?.parameters ?? [];

  it.each(["/search/plain", "/search/refined", "/search/transformed", "/search/strict"])("documents every key of %s", (path) => {
    expect(params(path).map((p) => p.name)).toEqual(["page", "q", "sort"]);
  });

  it.each(["/search/plain", "/search/refined", "/search/transformed", "/search/strict"])("%s: only a key with neither a default nor optional is required", (path) => {
    expect(Object.fromEntries(params(path).map((p) => [p.name, p.required]))).toEqual({ page: false, q: false, sort: true });
  });

  it("documents the type of each key, an enum included", () => {
    const sort = params("/search/refined").find((p) => p.name === "sort");

    expect(sort?.schema).toMatchObject({ enum: ["asc", "desc"] });
    expect(params("/search/plain").find((p) => p.name === "page")?.schema).toMatchObject({ type: "number" });
  });
});


describe("generateOpenApiDocument: security", () => {
  @ApiSecurity("bearerAuth")
  @Controller("private")
  class PrivateController {
    @Get()
    list() {
      return [];
    }

    @ApiSecurity(false)
    @Get("health")
    health() {
      return {};
    }

    @ApiSecurity({ oauth: ["read", "write"] }, "apiKey")
    @Post()
    create() {
      return {};
    }
  }

  @Controller("open")
  class OpenController {
    @Get()
    list() {
      return [];
    }
  }

  const securitySchemes = {
    bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    oauth: { type: "oauth2", flows: {} },
    apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
  };
  const generate = (options: Record<string, unknown>) =>
    generateOpenApiDocument({ controllers: [PrivateController, OpenController] }, { title: "t", version: "1", securitySchemes, ...options });

  it("declares the schemes under components and leaves them out when none are given", () => {
    expect(generate({}).components.securitySchemes).toEqual(securitySchemes);
    expect(generateOpenApiDocument({ controllers: [OpenController] }, { title: "t", version: "1" }).components).not.toHaveProperty("securitySchemes");
  });

  it("puts a controller's requirement on each of its operations, and a method's own value over it", () => {
    const document = generate({});

    expect(document.paths["/private"]?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(document.paths["/private"]?.post?.security).toEqual([{ oauth: ["read", "write"] }, { apiKey: [] }]);
  });

  it("marks a route with @ApiSecurity(false) as public with an empty requirement list", () => {
    expect(generate({ security: ["bearerAuth"] }).paths["/private/health"]?.get?.security).toEqual([]);
  });

  it("adds a document-wide requirement without touching operations that do not set one", () => {
    const document = generate({ security: ["bearerAuth"] });

    expect(document.security).toEqual([{ bearerAuth: [] }]);
    expect(document.paths["/open"]?.get).not.toHaveProperty("security");
  });

  it("omits document-level security when none is given", () => {
    expect(generate({})).not.toHaveProperty("security");
  });

  it("refuses a requirement that names a scheme that was not declared, naming the route", () => {
    expect(() => generate({ securitySchemes: { bearerAuth: securitySchemes.bearerAuth } })).toThrow(/PrivateController\.create requires security scheme "oauth"/);
    expect(() => generate({ security: ["nope"] })).toThrow(/document's `security` requires security scheme "nope"/);
  });
});

describe("generateOpenApiDocument: optional request bodies and empty responses", () => {
  const Create = z.object({ title: z.string() });

  @Controller("bodies")
  class BodiesController {
    @Post("required")
    required(@Body(Create) _body: unknown) {
      return {};
    }

    @Post("optional")
    optional(@Body(Create.optional()) _body: unknown) {
      return {};
    }

    @Post("anything")
    anything(@Body(z.unknown()) _body: unknown) {
      return {};
    }

    @Post("async")
    async(@Body(z.string().refine(async () => true)) _body: unknown) {
      return {};
    }

    @Get("maybe")
    @Returns(Create.optional())
    maybe() {
      return undefined;
    }

    @Get("maybe-created")
    @HttpCode(202)
    @Returns(Create.optional())
    maybeCreated() {
      return undefined;
    }

    @Get("always")
    @Returns(Create)
    always() {
      return {};
    }
  }

  const document = generateOpenApiDocument({ controllers: [BodiesController] }, { title: "t", version: "1" });

  it("marks the body required unless the schema accepts a missing value", () => {
    expect(document.paths["/bodies/required"]?.post?.requestBody?.required).toBe(true);
    expect(document.paths["/bodies/optional"]?.post?.requestBody?.required).toBe(false);
    expect(document.paths["/bodies/anything"]?.post?.requestBody?.required).toBe(false);
  });

  it("treats a schema it cannot check synchronously as required", () => {
    expect(document.paths["/bodies/async"]?.post?.requestBody?.required).toBe(true);
  });

  it("documents 204 next to 200 when the @Returns schema accepts undefined, as the handler answers 204 for it", () => {
    expect(Object.keys(document.paths["/bodies/maybe"]?.get?.responses ?? {})).toEqual(["200", "204", "default"]);
    expect(document.paths["/bodies/maybe"]?.get?.responses["204"]).toEqual({ description: "No content" });
  });

  it("adds no 204 when @HttpCode picks the status for every outcome, or the schema requires a value", () => {
    expect(Object.keys(document.paths["/bodies/maybe-created"]?.get?.responses ?? {})).toEqual(["202", "default"]);
    expect(Object.keys(document.paths["/bodies/always"]?.get?.responses ?? {})).toEqual(["200", "default"]);
  });
});

// Zod leaves a lazy schema whose definition threw half-built, so each use gets a fresh one.
const lazyController = () => {
  @Controller("lazy")
  class LazyController {
    @Post()
    create(
      @Body(
        z.lazy((): z.ZodType => {
          throw new Error("definition could not be built");
        }),
      )
      _body: unknown,
    ) {
      return {};
    }
  }
  return LazyController;
};

const generate = (controllers: Array<new () => object>, onUnrepresentable?: "open" | "warn" | "throw") =>
  generateOpenApiDocument({ controllers }, { title: "t", version: "1", ...(onUnrepresentable ? { onUnrepresentable } : {}) });

describe("generateOpenApiDocument: onUnrepresentable", () => {
  @Controller("custom")
  class CustomController {
    @Post()
    create(@Body(z.object({ id: z.custom<string>(() => true) })) _body: unknown) {
      return {};
    }
  }

  @Controller("transformed")
  class TransformedController {
    @Get()
    @Returns(z.string().transform((value) => value.length))
    get() {
      return "x";
    }
  }

  @Controller("fine")
  class OpenByDesignController {
    @Post()
    create(@Body(z.object({ anything: z.unknown(), whatever: z.any(), when: z.date(), n: z.number().default(1) })) _body: unknown) {
      return {};
    }
  }

  it("documents the open schema silently by default, as before", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => generate([CustomController, TransformedController, lazyController()])).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns with the route and the schema type, and still documents it as open", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const document = generate([CustomController, TransformedController, lazyController()], "warn");

    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages).toContainEqual(expect.stringContaining("CustomController.create: a `custom` schema (input side)"));
    expect(messages).toContainEqual(expect.stringContaining("TransformedController.get: a `transform` schema (output side)"));
    expect(messages).toContainEqual(expect.stringContaining("LazyController.create: the schema could not be converted to JSON Schema (definition could not be built)"));
    expect(document.paths["/custom"]?.post?.requestBody?.content["application/json"].schema).toBeDefined();
    warn.mockRestore();
  });

  it.each([
    ["custom", CustomController, /CustomController\.create: a `custom` schema/],
    ["transform", TransformedController, /TransformedController\.get: a `transform` schema/],
  ])("throws for a %s schema in strict mode, naming the route", (_name, controller, message) => {
    expect(() => generate([controller], "throw")).toThrow(message);
  });

  it("throws for a schema that cannot be converted at all in strict mode, naming the route", () => {
    expect(() => generate([lazyController()], "throw")).toThrow(/LazyController\.create: the schema could not be converted .*definition could not be built/);
  });

  it("does not flag z.any(), z.unknown(), a date or a defaulted field, in any mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => generate([OpenByDesignController], "throw")).not.toThrow();
    generate([OpenByDesignController], "warn");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

const make = (name: string) => {
  @Controller(name)
  class Same {
    @Get()
    list() {
      return [];
    }
  }
  return Same;
};

describe("generateOpenApiDocument: operationId", () => {
  it("refuses two operations with the same operationId, naming both", () => {
    expect(() => generateOpenApiDocument({ controllers: [make("a"), make("b")] }, { title: "t", version: "1" })).toThrow(
      /operationId "Same_list" is used by both Same\.list and Same\.list/,
    );
  });

  it("accepts an explicit operationId that tells them apart", () => {
    @Controller("c")
    class Same {
      @ApiOperation({ operationId: "listC" })
      @Get()
      list() {
        return [];
      }
    }

    const document = generateOpenApiDocument({ controllers: [make("a"), Same] }, { title: "t", version: "1" });

    expect(document.paths["/c"]?.get?.operationId).toBe("listC");
  });
});
