import { createApplication, Module } from "@blixis-io/core";
import { Injectable, type Class, type Provider } from "@blixis-io/di";
import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Controller } from "./decorators/controller.js";
import { Body, Param, Query, Req } from "./decorators/params.js";
import { Delete, Get, HttpCode, Post, Returns } from "./decorators/routes.js";
import type { CanActivate, ExecutionContext } from "./decorators/guards.js";
import { UseGuards } from "./decorators/guards.js";
import type { Interceptor } from "./decorators/interceptors.js";
import { UseInterceptors } from "./decorators/interceptors.js";
import { HttpException, NotFoundException, UnauthorizedException } from "./exceptions.js";
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

  it("stops reading a chunked body (no content-length) as soon as the limit is crossed", async () => {
    @Module({ providers: [PostService], controllers: [PostController] })
    class AppModule {}
    const app = await createApplication(AppModule);
    const handle = createHandler(app.controllers, app, { bodyLimit: 10 });

    let pulled = 0;
    let cancelled = false;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(encoder.encode("x".repeat(8)));
      },
      cancel() {
        cancelled = true;
      },
    });

    const res = await handle(
      new Request("http://localhost/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        duplex: "half",
      }),
    );

    expect(res.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(5);
  });

  it("returns 400, not a logged 500, when the body stream errors mid-read (the client went away)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const handle = await buildHandler();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"title":'));
        controller.error(new Error("aborted"));
      },
    });

    const res = await handle(
      new Request("http://localhost/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        duplex: "half",
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json() as { detail: string }).detail).toBe("Request body was not fully received");
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("createHandler: responseValidation policy", () => {
  const UserSchema = z.object({ id: z.string() });

  @Controller("users")
  class UsersController {
    @Get("default")
    @Returns(UserSchema)
    byDefault() {
      return { id: "1", passwordHash: "secret" };
    }

    @Get("skip")
    @Returns(UserSchema, { validate: false })
    skipped() {
      return { id: "1", passwordHash: "secret" };
    }

    @Get("force")
    @Returns(UserSchema, { validate: true })
    forced() {
      return { id: "1", passwordHash: "secret" };
    }

    @Get("broken")
    @Returns(UserSchema, { validate: false })
    broken() {
      return { id: 1 };
    }
  }

  async function usersHandler(responseValidation?: "always" | "never") {
    @Module({ controllers: [UsersController] })
    class AppModule {}
    const app = await createApplication(AppModule);
    return createHandler(app.controllers, app, responseValidation === undefined ? {} : { responseValidation });
  }

  it("validates and strips unknown keys by default", async () => {
    const handle = await usersHandler();

    const res = await handle(new Request("http://localhost/users/default"));

    expect(await res.json()).toEqual({ id: "1" });
  });

  it('sends handler values as-is under responseValidation "never"', async () => {
    const handle = await usersHandler("never");

    const res = await handle(new Request("http://localhost/users/default"));

    expect(await res.json()).toEqual({ id: "1", passwordHash: "secret" });
  });

  it("lets a route opt out with validate: false while the app validates", async () => {
    const handle = await usersHandler("always");

    const res = await handle(new Request("http://localhost/users/skip"));

    expect(await res.json()).toEqual({ id: "1", passwordHash: "secret" });
  });

  it("does not turn a contract violation into a 500 when validation is skipped", async () => {
    const handle = await usersHandler();

    const res = await handle(new Request("http://localhost/users/broken"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1 });
  });

  it('lets a route force validation on with validate: true under "never"', async () => {
    const handle = await usersHandler("never");

    const res = await handle(new Request("http://localhost/users/force"));

    expect(await res.json()).toEqual({ id: "1" });
  });
});

describe("createHandler: requestTimeout", () => {
  @Controller("slow")
  class SlowController {
    @Get("wait")
    async wait(@Req() request: Request): Promise<{ aborted: boolean }> {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { aborted: request.signal.aborted };
    }

    @Get("fast")
    fast(): { ok: true } {
      return { ok: true };
    }
  }

  async function slowHandler(requestTimeout?: number) {
    @Module({ controllers: [SlowController] })
    class AppModule {}
    const app = await createApplication(AppModule);
    return createHandler(app.controllers, app, requestTimeout === undefined ? {} : { requestTimeout });
  }

  it("returns 504 problem+json when the handler outlives the timeout", async () => {
    const handle = await slowHandler(10);

    const res = await handle(new Request("http://localhost/slow/wait"));

    expect(res.status).toBe(504);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  it("lets a request that finishes in time through untouched", async () => {
    const handle = await slowHandler(1000);

    const res = await handle(new Request("http://localhost/slow/fast"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("exposes the timeout to the handler through request.signal", async () => {
    const seen: boolean[] = [];

    @Controller("probe")
    class ProbeController {
      @Get()
      async probe(@Req() request: Request): Promise<{ ok: true }> {
        await new Promise((resolve) => setTimeout(resolve, 50));
        seen.push(request.signal.aborted);
        return { ok: true };
      }
    }

    @Module({ controllers: [ProbeController] })
    class AppModule {}
    const app = await createApplication(AppModule);
    const handle = createHandler(app.controllers, app, { requestTimeout: 10 });

    await handle(new Request("http://localhost/probe"));
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(seen).toEqual([true]);
  });

  it("answers 499 when the client aborts before the timeout", async () => {
    const handle = await slowHandler(1000);
    const controller = new AbortController();

    const pending = handle(new Request("http://localhost/slow/wait", { signal: controller.signal }));
    controller.abort();

    expect((await pending).status).toBe(499);
  });

  it("never times out when requestTimeout is unset", async () => {
    const handle = await slowHandler();

    const res = await handle(new Request("http://localhost/slow/wait"));

    expect(res.status).toBe(200);
  });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createHandler: requestTimeout covers guards", () => {
  const calls: string[] = [];
  let guardSignal: AbortSignal | undefined;

  @Injectable()
  class HangingGuard implements CanActivate {
    canActivate(): Promise<boolean> {
      return new Promise<boolean>(() => {});
    }
  }

  @Injectable()
  class LateGuard implements CanActivate {
    async canActivate({ request }: ExecutionContext): Promise<boolean> {
      guardSignal = request.signal;
      await new Promise((resolve) => setTimeout(resolve, 60));
      calls.push("late guard settled");
      return true;
    }
  }

  @Injectable()
  class SecondGuard implements CanActivate {
    canActivate(): boolean {
      calls.push("second guard ran");
      return true;
    }
  }

  @Controller("hang")
  @UseGuards(HangingGuard)
  class HangingController {
    @Get()
    ping() {
      calls.push("handler ran");
      return { ok: true };
    }
  }

  @Controller("late")
  @UseGuards(LateGuard, SecondGuard)
  class LateController {
    @Get()
    ping() {
      calls.push("handler ran");
      return { ok: true };
    }
  }

  async function handlerFor(requestTimeout?: number) {
    @Module({ providers: [HangingGuard, LateGuard, SecondGuard], controllers: [HangingController, LateController] })
    class AppModule {}
    const app = await createApplication(AppModule);
    return createHandler(app.controllers, app, requestTimeout === undefined ? {} : { requestTimeout });
  }

  beforeEach(() => {
    calls.length = 0;
    guardSignal = undefined;
  });

  it("answers 504 within the budget when a guard never settles", async () => {
    const handle = await handlerFor(30);

    const outcome = await Promise.race([handle(new Request("http://localhost/hang")), sleep(1000).then(() => "no response")]);

    expect(outcome).toBeInstanceOf(Response);
    expect((outcome as Response).status).toBe(504);
    expect((outcome as Response).headers.get("content-type")).toBe("application/problem+json");
    expect(calls).toEqual([]);
  });

  it("does not start the next guard or the controller after the deadline has passed", async () => {
    const handle = await handlerFor(20);

    const res = await handle(new Request("http://localhost/late"));
    await sleep(120);

    expect(res.status).toBe(504);
    expect(calls).toEqual(["late guard settled"]);
  });

  it("gives guards the deadline through request.signal", async () => {
    const handle = await handlerFor(20);

    await handle(new Request("http://localhost/late"));
    await sleep(120);

    expect(guardSignal?.aborted).toBe(true);
  });

  it("answers 499 when the client leaves during a guard, and does not run the controller", async () => {
    const handle = await handlerFor(1000);
    const controller = new AbortController();

    const pending = handle(new Request("http://localhost/late", { signal: controller.signal }));
    await sleep(10);
    controller.abort();
    const res = await pending;
    await sleep(120);

    expect(res.status).toBe(499);
    expect(calls).toEqual(["late guard settled"]);
  });

  it("is unchanged when requestTimeout is unset: a slow guard still lets the request through", async () => {
    const handle = await handlerFor();

    const res = await handle(new Request("http://localhost/late"));

    expect(res.status).toBe(200);
    expect(calls).toEqual(["late guard settled", "second guard ran", "handler ran"]);
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

  it("falls back to a generic title for a status code with no registered reason phrase", async () => {
    @Controller("weird")
    class WeirdController {
      @Get()
      boom(): never {
        throw new HttpException(499, "Custom status");
      }
    }

    @Module({ controllers: [WeirdController] })
    class AppModule {}
    const app = await createApplication(AppModule);
    const handle = createHandler(app.controllers, app);

    const res = await handle(new Request("http://localhost/weird"));

    expect(res.status).toBe(499);
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

describe("createHandler: interceptors", () => {
  let calls: string[];

  beforeEach(() => {
    calls = [];
  });

  class OuterInterceptor implements Interceptor {
    async intercept(_context: ExecutionContext, next: () => Promise<Response>): Promise<Response> {
      calls.push("outer:before");
      const res = await next();
      calls.push("outer:after");
      return res;
    }
  }

  class InnerInterceptor implements Interceptor {
    async intercept(_context: ExecutionContext, next: () => Promise<Response>): Promise<Response> {
      calls.push("inner:before");
      const res = await next();
      calls.push("inner:after");
      return res;
    }
  }

  it("calls through to the handler when there are no interceptors", async () => {
    const handle = await buildHandler();

    const res = await handle(new Request("http://localhost/posts/1"));

    expect(res.status).toBe(200);
  });

  it("runs class-level interceptors outermost and method-level innermost, onion-style", async () => {
    @UseInterceptors(OuterInterceptor)
    @Controller("wrapped")
    class WrappedController {
      @UseInterceptors(InnerInterceptor)
      @Get()
      ok() {
        calls.push("handler");
        return { ok: true };
      }
    }

    const handle = await buildHandler([OuterInterceptor, InnerInterceptor], [WrappedController]);
    const res = await handle(new Request("http://localhost/wrapped"));

    expect(res.status).toBe(200);
    expect(calls).toEqual(["outer:before", "inner:before", "handler", "inner:after", "outer:after"]);
  });

  it("can transform the response returned by the handler", async () => {
    class HeaderInterceptor implements Interceptor {
      async intercept(_context: ExecutionContext, next: () => Promise<Response>): Promise<Response> {
        const res = await next();
        res.headers.set("x-intercepted", "true");
        return res;
      }
    }

    @UseInterceptors(HeaderInterceptor)
    @Controller("tagged")
    class TaggedController {
      @Get()
      ok() {
        return { ok: true };
      }
    }

    const handle = await buildHandler([HeaderInterceptor], [TaggedController]);
    const res = await handle(new Request("http://localhost/tagged"));

    expect(res.headers.get("x-intercepted")).toBe("true");
  });

  it("lets an interceptor observe and rethrow an error from next()", async () => {
    let observed: unknown;

    class ObservingInterceptor implements Interceptor {
      async intercept(_context: ExecutionContext, next: () => Promise<Response>): Promise<Response> {
        try {
          return await next();
        } catch (error) {
          observed = error;
          throw error;
        }
      }
    }

    @UseInterceptors(ObservingInterceptor)
    @Controller("watched")
    class WatchedController {
      @Get()
      boom(): never {
        throw new NotFoundException("watched not found");
      }
    }

    const handle = await buildHandler([ObservingInterceptor], [WatchedController]);
    const res = await handle(new Request("http://localhost/watched"));

    expect(res.status).toBe(404);
    expect(observed).toBeInstanceOf(NotFoundException);
  });

  it("guards still run before interceptors and can deny the request first", async () => {
    class DenyGuard implements CanActivate {
      canActivate(): boolean {
        return false;
      }
    }

    class NeverCalledInterceptor implements Interceptor {
      async intercept(_context: ExecutionContext, next: () => Promise<Response>): Promise<Response> {
        calls.push("should not run");
        return next();
      }
    }

    @UseGuards(DenyGuard)
    @UseInterceptors(NeverCalledInterceptor)
    @Controller("blocked")
    class BlockedController {
      @Get()
      ok() {
        return { ok: true };
      }
    }

    const handle = await buildHandler([DenyGuard, NeverCalledInterceptor], [BlockedController]);
    const res = await handle(new Request("http://localhost/blocked"));

    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe("createHandler: @Returns response validation", () => {
  const ItemSchema = z.object({ id: z.string(), count: z.coerce.number() });

  it("passes through a value that matches the declared schema", async () => {
    @Controller("valid")
    class ValidController {
      @Get()
      @Returns(ItemSchema)
      ok() {
        return { id: "1", count: 2 };
      }
    }

    const handle = await buildHandler([], [ValidController]);
    const res = await handle(new Request("http://localhost/valid"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "1", count: 2 });
  });

  it("sends the parsed/coerced value, not the raw handler return value", async () => {
    @Controller("coerced")
    class CoercedController {
      @Get()
      @Returns(ItemSchema)
      ok() {
        return { id: "1", count: "2" };
      }
    }

    const handle = await buildHandler([], [CoercedController]);
    const res = await handle(new Request("http://localhost/coerced"));

    expect(await res.json()).toEqual({ id: "1", count: 2 });
  });

  it("returns a generic 500 (not schema issues) when the handler's return value fails its declared schema", async () => {
    @Controller("broken")
    class BrokenController {
      @Get()
      @Returns(ItemSchema)
      ok() {
        return { id: "1" }; // missing "count"
      }
    }

    const handle = await buildHandler([], [BrokenController]);
    const res = await handle(new Request("http://localhost/broken"));

    expect(res.status).toBe(500);
    const problem = (await res.json()) as { detail: string };
    expect(problem.detail).toBe("An unexpected error occurred");
    expect(JSON.stringify(problem)).not.toContain("count");
  });

  it("skips validation for a route returning undefined (204), even with @Returns declared", async () => {
    @Controller("empty")
    class EmptyController {
      @Delete()
      @Returns(ItemSchema)
      remove(): undefined {
        return undefined;
      }
    }

    const handle = await buildHandler([], [EmptyController]);
    const res = await handle(new Request("http://localhost/empty", { method: "DELETE" }));

    expect(res.status).toBe(204);
  });

  it("skips validation for a route returning a raw Response, even with @Returns declared", async () => {
    @Controller("raw-returns")
    class RawController {
      @Get()
      @Returns(ItemSchema)
      ok() {
        return new Response("not json", { status: 200, headers: { "content-type": "text/plain" } });
      }
    }

    const handle = await buildHandler([], [RawController]);
    const res = await handle(new Request("http://localhost/raw-returns"));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("not json");
  });

  it("a route without @Returns is unvalidated, exactly as before", async () => {
    const handle = await buildHandler();

    const res = await handle(new Request("http://localhost/posts/1"));

    expect(res.status).toBe(200);
  });
});

describe("createHandler: path params", () => {
  @Controller("things")
  class ThingController {
    @Get(":id")
    one(@Param("id") id: string) {
      return { id: id ?? null };
    }

    @Delete(":thingId")
    remove(@Param("thingId") thingId: string) {
      return { removed: thingId ?? null };
    }
  }

  @Module({ controllers: [ThingController] })
  class ThingModule {}

  async function handler() {
    const app = await createApplication(ThingModule);
    return createHandler(app.controllers, app);
  }

  it("hands each method the param under the name its own route declared", async () => {
    const handle = await handler();

    const get = await handle(new Request("http://localhost/things/5"));
    const del = await handle(new Request("http://localhost/things/5", { method: "DELETE" }));

    expect(await get.json()).toEqual({ id: "5" });
    expect(await del.json()).toEqual({ removed: "5" });
  });

  it("decodes percent-encoded params before the handler sees them", async () => {
    const handle = await handler();

    const res = await handle(new Request("http://localhost/things/hello%20world%2Fcafé"));

    expect(await res.json()).toEqual({ id: "hello world/café" });
  });

  it("answers 400 problem+json for a malformed escape, without running a guard or handler", async () => {
    const handle = await handler();

    const res = await handle(new Request("http://localhost/things/100%25%E0%A4%A"));

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(((await res.json()) as { detail: string }).detail).toBe("Malformed percent-encoding in the request path");
  });
});

describe("createHandler: problem responses from exceptions", () => {
  @Controller("fail")
  class FailController {
    @Get("slow-down")
    slowDown(): never {
      throw new HttpException(429, "Try again later", undefined, { "retry-after": "30" });
    }

    @Get("unprocessable")
    unprocessable(): never {
      throw new HttpException(422, "Cannot process this");
    }

    @Get("unavailable")
    unavailable(): never {
      throw new HttpException(503, "Down for maintenance");
    }

    @Get("challenge")
    challenge(): never {
      throw new UnauthorizedException("Missing token", "Bearer");
    }

    @Get("no-challenge")
    noChallenge(): never {
      throw new UnauthorizedException("Missing token");
    }
  }

  @Module({ controllers: [FailController] })
  class FailModule {}

  async function handler() {
    const app = await createApplication(FailModule);
    return createHandler(app.controllers, app);
  }

  it.each([
    ["/fail/slow-down", 429, "Too Many Requests"],
    ["/fail/unprocessable", 422, "Unprocessable Entity"],
    ["/fail/unavailable", 503, "Service Unavailable"],
  ])("titles %s as %s", async (path, status, title) => {
    const res = await (await handler())(new Request(`http://localhost${path}`));

    expect(res.status).toBe(status);
    expect(((await res.json()) as { title: string }).title).toBe(title);
  });

  it("sends the exception's headers with the problem response", async () => {
    const res = await (await handler())(new Request("http://localhost/fail/slow-down"));

    expect(res.headers.get("retry-after")).toBe("30");
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  it("sends WWW-Authenticate with a 401 that names a challenge", async () => {
    const res = await (await handler())(new Request("http://localhost/fail/challenge"));

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("sends none when the exception names no challenge", async () => {
    const res = await (await handler())(new Request("http://localhost/fail/no-challenge"));

    expect(res.status).toBe(401);
    expect(res.headers.has("www-authenticate")).toBe(false);
  });
});

describe("createHandler: the request's JSON media type", () => {
  @Controller("echo")
  class EchoController {
    @Post()
    echo(@Body() body: unknown) {
      return { body };
    }
  }

  @Module({ controllers: [EchoController] })
  class EchoModule {}

  async function post(contentType: string): Promise<Response> {
    const app = await createApplication(EchoModule);
    const handle = createHandler(app.controllers, app);
    return handle(new Request("http://localhost/echo", { method: "POST", headers: { "content-type": contentType }, body: '{"a":1}' }));
  }

  it.each([
    "application/json",
    "application/json; charset=utf-8",
    "application/json;charset=UTF-8",
    'application/json; charset="utf-8"',
    "APPLICATION/JSON",
    "application/vnd.api+json",
    "application/merge-patch+json",
  ])("accepts %s", async (contentType) => {
    const res = await post(contentType);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ body: { a: 1 } });
  });

  it.each(["application/jsonp", "application/json5", "application/jsonl", "text/json", "application/x-www-form-urlencoded", "application/jsonx; charset=utf-8"])(
    "rejects %s with 415",
    async (contentType) => {
      expect((await post(contentType)).status).toBe(415);
    },
  );

  it("rejects a JSON body declared in another charset, since it is always read as UTF-8", async () => {
    const res = await post("application/json; charset=iso-8859-1");

    expect(res.status).toBe(415);
    expect(((await res.json()) as { detail: string }).detail).toContain("UTF-8");
  });
});
