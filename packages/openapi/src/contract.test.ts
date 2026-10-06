import { Module } from "@blixis-io/core";
import {
  Body,
  Controller,
  createHttpApplication,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Returns,
  type HttpApplication,
} from "@blixis-io/http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { generateOpenApiDocument, type OpenApiDocument } from "./generate.js";

const PostSchema = z.object({ id: z.string(), title: z.string() });
const CreatePost = z.object({ title: z.string().min(1) });

@Controller("posts")
class PostsController {
  @Get(":id")
  @Returns(PostSchema)
  get(@Param("id") id: string) {
    if (id !== "1") {
      throw new NotFoundException();
    }
    return { id, title: "first" };
  }

  @Post()
  @HttpCode(201)
  @Returns(PostSchema)
  create(@Body(CreatePost) body: z.infer<typeof CreatePost>) {
    return { id: "2", title: body.title };
  }

  @Delete(":id")
  @HttpCode(204)
  remove(): undefined {
    return undefined;
  }

  @Get("maybe/:id")
  @Returns(PostSchema.optional())
  maybe(@Param("id") id: string) {
    return id === "1" ? { id, title: "first" } : undefined;
  }
}

@Module({ controllers: [PostsController] })
class AppModule {}

/** The OpenAPI path template (`/posts/{id}`) a concrete request path belongs to. */
function templateFor(document: OpenApiDocument, path: string): string | undefined {
  return Object.keys(document.paths).find((template) => new RegExp(`^${template.replaceAll(/\{[^}]+\}/g, "[^/]+")}$`).test(path));
}

describe("OpenAPI document against real responses", () => {
  let app: HttpApplication;
  let document: OpenApiDocument;

  beforeAll(async () => {
    app = await createHttpApplication(AppModule);
    document = generateOpenApiDocument(app, { title: "contract", version: "1" });
  });

  afterAll(async () => {
    await app.close();
  });

  const send = (method: string, path: string, body?: unknown) =>
    app.handle(
      new Request(`http://localhost${path}`, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      }),
    );

  it.each([
    ["GET", "/posts/1", undefined],
    ["POST", "/posts", { title: "new" }],
    ["DELETE", "/posts/1", undefined],
    ["GET", "/posts/maybe/1", undefined],
    ["GET", "/posts/maybe/2", undefined],
    ["GET", "/posts/9", undefined],
    ["POST", "/posts", { title: "" }],
  ])("%s %s: the status and media type are the ones the document declares", async (method, path, body) => {
    const response = await send(method, path, body);

    const operation = document.paths[templateFor(document, path) ?? ""]?.[method.toLowerCase()];
    expect(operation, `no operation documented for ${method} ${path}`).toBeDefined();
    const declared = operation?.responses[String(response.status)] ?? operation?.responses["default"];
    expect(declared, `status ${response.status} is not documented for ${method} ${path}`).toBeDefined();

    // A response with no body must document none; one with a body must document its media type.
    const mediaType = response.headers.get("content-type")?.split(";")[0];
    const documented = Object.keys(declared?.content ?? {});
    expect(mediaType === undefined ? documented : documented.filter((type) => type === mediaType), `media type ${String(mediaType)} versus ${documented.join(", ")}`).toEqual(
      mediaType === undefined ? [] : [mediaType],
    );
  });

  it("documents the errors it really sends as problem+json, and the success bodies as json", async () => {
    const error = await send("GET", "/posts/9");
    const ok = await send("GET", "/posts/1");

    expect(error.headers.get("content-type")).toBe("application/problem+json");
    expect(Object.keys(document.paths["/posts/{id}"]?.get?.responses["default"]?.content ?? {})).toEqual(["application/problem+json"]);
    expect(ok.headers.get("content-type")).toBe("application/json");
  });

  it("only contains $ref values that resolve inside the document", () => {
    const refs = [...JSON.stringify(document).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map((match) => match[1]);

    expect(refs.length).toBeGreaterThan(0);
    for (const name of refs) {
      expect(document.components.schemas).toHaveProperty(name ?? "");
    }
  });
});
