import { createApplication, Module } from "@blixis/core";
import { Injectable, type Class, type Provider } from "@blixis/di";
import { z } from "zod";
import { beforeEach, describe, expect, it } from "vitest";
import { Controller } from "./decorators/controller.js";
import { Body, Param, Query } from "./decorators/params.js";
import { Delete, Get, HttpCode, Post } from "./decorators/routes.js";
import type { CanActivate, ExecutionContext } from "./decorators/guards.js";
import { UseGuards } from "./decorators/guards.js";
import { HttpException, NotFoundException } from "./exceptions.js";
import { createHandler, NotAControllerError } from "./handler.js";

const CreatePost = z.object({ title: z.string().min(1) });

@Injectable()
class PostService {
  #posts = new Map<string, { id: string; title: string }>([["1", { id: "1", title: "first" }]]);

  list(): Array<{ id: string; title: string }> {
    return [...this.#posts.values()];
  }

  get(id: string): { id: string; title: string } {
    const post = this.#posts.get(id);
    if (!post) {
      throw new NotFoundException(`Post ${id} not found`);
    }
    return post;
  }

  create(title: string): { id: string; title: string } {
    const id = String(this.#posts.size + 1);
    const post = { id, title };
    this.#posts.set(id, post);
    return post;
  }
}

@Controller("posts")
class PostController {
  constructor(private readonly posts: PostService) {}

  @Get()
  list(@Query() query: unknown) {
    return { items: this.posts.list(), query };
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.posts.get(id);
  }

  @Post()
  @HttpCode(201)
  create(@Body(CreatePost) body: z.infer<typeof CreatePost>) {
    return this.posts.create(body.title);
  }

  @Delete(":id")
  remove(): undefined {
    return undefined;
  }

  @Get("raw")
  raw() {
    return new Response("plain text", { status: 200, headers: { "content-type": "text/plain" } });
  }

  @Get("boom")
  boom(): never {
    throw new Error("something broke internally");
  }
}

async function buildHandler(extraProviders: Provider[] = [], extraControllers: Class[] = []) {
  @Module({
    providers: [PostService, ...extraProviders],
    controllers: [PostController, ...extraControllers],
  })
  class AppModule {}

  const app = await createApplication(AppModule);
  return createHandler(app.controllers, app);
}

describe("createHandler: routing + status codes", () => {
  it("returns 200 JSON for a GET route", async () => {
    const handle = await buildHandler();

    const res = await handle(new Request("http://localhost/posts"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ items: [{ id: "1", title: "first" }], query: {} });
  });

  it("extracts a route param", async () => {
    const handle = await buildHandler();

    const res = await handle(new Request("http://localhost/posts/1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "1", title: "first" });
  });

  it("applies @HttpCode to override the default status", async () => {
    const handle = await buildHandler();

    const res = await handle(
      new Request("http://localhost/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "second" }),
      }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "2", title: "second" });
  });

  it("returns 204 with no body when the handler returns undefined", async () => {
    const handle = await buildHandler();

    const res = await handle(new Request("http://localhost/posts/1", { method: "DELETE" }));

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("passes a returned Response through unchanged", async () => {
    const handle = await buildHandler();

    const res = await handle(new Request("http://localhost/posts/raw"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await res.text()).toBe("plain text");
  });
});

describe("createHandler: validation", () => {
  it("returns 201 when the body passes schema validation", async () => {
    const handle = await buildHandler();

    const res = await handle(
      new Request("http://localhost/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "valid" }),
      }),
    );

    expect(res.status).toBe(201);
  });

  it("returns 400 problem+json with issues when the body fails schema validation", async () => {
    const handle = await buildHandler();

    const res = await handle(
      new Request("http://localhost/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "" }),
      }),
    );

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    const problem = (await res.json()) as { status: number; issues: unknown[] };
    expect(problem.status).toBe(400);
    expect(problem.issues).toBeInstanceOf(Array);
    expect(problem.issues.length).toBeGreaterThan(0);
  });

  it("returns 415 for a POST with a non-JSON content type", async () => {
    const handle = await buildHandler();

    const res = await handle(
      new Request("http://localhost/posts", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "title=x",
      }),
    );

    expect(res.status).toBe(415);
  });

  it("returns 415 for a POST with a body and no content-type header at all", async () => {
    const handle = await buildHandler();

    // A raw byte body (unlike a string body) gets no automatic content-type
    // from the Fetch spec, so this genuinely has no content-type header.
    const res = await handle(
      new Request("http://localhost/posts", {
        method: "POST",
        body: new TextEncoder().encode("title=x"),
      }),
    );

    expect(res.status).toBe(415);
  });

  it("returns 400 for a POST with no body sent at all (request.body is null)", async () => {
    const handle = await buildHandler();

    const res = await handle(new Request("http://localhost/posts", { method: "POST" }));

    expect(res.status).toBe(400);
  });

  it("returns 400 for a POST with an empty JSON body", async () => {
    const handle = await buildHandler();

    const res = await handle(
      new Request("http://localhost/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "",
      }),
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 problem+json for a POST with malformed JSON", async () => {
    const handle = await buildHandler();

    const res = await handle(
      new Request("http://localhost/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not valid json",
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json() as { detail: string }).detail).toBe("Invalid JSON body");
  });

  it("returns 413 when the body exceeds the configured limit", async () => {
    @Module({ providers: [PostService], controllers: [PostController] })
    class AppModule {}
    const app = await createApplication(AppModule);
    const handle = createHandler(app.controllers, app, { bodyLimit: 10 });

    const res = await handle(
      new Request("http://localhost/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "this body is definitely over ten bytes" }),
      }),
    );

    expect(res.status).toBe(413);
  });

  it("returns 413 based on a declared content-length header alone, before reading the body", async () => {
    @Module({ providers: [PostService], controllers: [PostController] })
    class AppModule {}
    const app = await createApplication(AppModule);
    const handle = createHandler(app.controllers, app, { bodyLimit: 10 });

    const res = await handle(
      new Request("http://localhost/posts", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "999999" },
        body: JSON.stringify({ title: "short" }),
      }),
    );

    expect(res.status).toBe(413);
  });
});

describe("createHandler: buildRouter", () => {
  it("throws NotAControllerError when a listed controller has no @Controller()", async () => {
    @Injectable()
    class BareClass {}

    @Module({ controllers: [BareClass] })
    class AppModule {}

    const app = await createApplication(AppModule);

    expect(() => createHandler(app.controllers, app)).toThrow(NotAControllerError);
  });
});

describe("createHandler: errors", () => {
  it("maps a thrown HttpException to the matching status and problem+json body", async () => {
    const handle = await buildHandler();

    const res = await handle(new Request("http://localhost/posts/999"));

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(((await res.json()) as { detail: string }).detail).toBe("Post 999 not found");
  });

  it("falls back to a generic title for a status code with no named mapping", async () => {
    @Controller("weird")
    class WeirdController {
      @Get()
      boom(): never {
        throw new HttpException(422, "Custom status");
      }
    }

    @Module({ controllers: [WeirdController] })
    class AppModule {}
    const app = await createApplication(AppModule);
    const handle = createHandler(app.controllers, app);

    const res = await handle(new Request("http://localhost/weird"));

    expect(res.status).toBe(422);
    const problem = (await res.json()) as { title: string; detail: string };
    expect(problem.title).toBe("Error");
    expect(problem.detail).toBe("Custom status");
  });

  it("maps an unexpected thrown error to 500 and hides the internal message", async () => {
    const handle = await buildHandler();

    const res = await handle(new Request("http://localhost/posts/boom"));

    expect(res.status).toBe(500);
    const problem = await res.json();
    expect(JSON.stringify(problem)).not.toContain("something broke internally");
  });

  it("returns 404 problem+json for an unknown path", async () => {
    const handle = await buildHandler();

    const res = await handle(new Request("http://localhost/nope"));

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  it("returns 405 with an Allow header for a known path with the wrong method", async () => {
    const handle = await buildHandler();

    const res = await handle(new Request("http://localhost/posts", { method: "PUT" }));

    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toContain("GET");
    expect(res.headers.get("allow")).toContain("POST");
  });
});

describe("createHandler: guards", () => {
  class AllowGuard implements CanActivate {
    canActivate(): boolean {
      return true;
    }
  }

  class DenyGuard implements CanActivate {
    canActivate(): boolean {
      return false;
    }
  }

  let contexts: ExecutionContext[];

  class RecordingGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      contexts.push(context);
      return true;
    }
  }

  beforeEach(() => {
    contexts = [];
  });

  it("allows the request through when the guard returns true", async () => {
    @Injectable()
    class Guarded {}

    @UseGuards(AllowGuard)
    @Controller("guarded")
    class GuardedController {
      @Get()
      ok() {
        return { ok: true };
      }
    }

    const handle = await buildHandler([AllowGuard, Guarded], [GuardedController]);
    const res = await handle(new Request("http://localhost/guarded"));

    expect(res.status).toBe(200);
  });

  it("returns 403 when a class-level guard returns false", async () => {
    @UseGuards(DenyGuard)
    @Controller("locked")
    class LockedController {
      @Get()
      ok() {
        return { ok: true };
      }
    }

    const handle = await buildHandler([DenyGuard], [LockedController]);
    const res = await handle(new Request("http://localhost/locked"));

    expect(res.status).toBe(403);
  });

  it("passes the request and matched route params to the guard", async () => {
    @Controller("recorded")
    class RecordedController {
      @UseGuards(RecordingGuard)
      @Get(":id")
      ok() {
        return { ok: true };
      }
    }

    const handle = await buildHandler([RecordingGuard], [RecordedController]);
    await handle(new Request("http://localhost/recorded/7"));

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.params).toEqual({ id: "7" });
  });
});
