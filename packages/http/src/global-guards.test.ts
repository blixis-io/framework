import { Module } from "@blixis-io/core";
import { Injectable } from "@blixis-io/di";
import { describe, expect, it } from "vitest";
import { Controller } from "./decorators/controller.js";
import { getRouteMetadata, GlobalGuard, SetRouteMetadata, UseGuards, type CanActivate, type ExecutionContext } from "./decorators/guards.js";
import type { Interceptor } from "./decorators/interceptors.js";
import { UseInterceptors } from "./decorators/interceptors.js";
import { Get } from "./decorators/routes.js";
import { ForbiddenException, UnauthorizedException } from "./exceptions.js";
import { createHttpApplication } from "./http-application.js";

const KEY = Symbol("test-key");
const OTHER = Symbol("other-key");
const calls: string[] = [];

async function appWith(providers: (new (...args: never[]) => object)[], controllers: (new (...args: never[]) => object)[]) {
  @Module({ providers, controllers })
  class AppModule {}
  return createHttpApplication(AppModule);
}

const get = (app: Awaited<ReturnType<typeof appWith>>, path: string) => app.handle(new Request(`http://localhost${path}`));

describe("ExecutionContext carries the route being handled", () => {
  it("gives guards the controller class and the handler name", async () => {
    const seen: { controller: string; handler: string | symbol }[] = [];

    @Injectable()
    class Spy implements CanActivate {
      canActivate(context: ExecutionContext): boolean {
        seen.push({ controller: context.controller.name, handler: context.handler });
        return true;
      }
    }

    @Controller("things")
    @UseGuards(Spy)
    class ThingsController {
      @Get("list")
      list() {
        return { ok: true };
      }
    }

    await get(await appWith([Spy], [ThingsController]), "/things/list");

    expect(seen).toEqual([{ controller: "ThingsController", handler: "list" }]);
  });

  it("gives interceptors the same context", async () => {
    const seen: string[] = [];

    @Injectable()
    class Spy implements Interceptor {
      intercept(context: ExecutionContext, next: () => Promise<Response>) {
        seen.push(`${context.controller.name}.${String(context.handler)}`);
        return next();
      }
    }

    @Controller("things")
    @UseInterceptors(Spy)
    class ThingsController {
      @Get("one")
      one() {
        return {};
      }
    }

    await get(await appWith([Spy], [ThingsController]), "/things/one");

    expect(seen).toEqual(["ThingsController.one"]);
  });
});

describe("@GlobalGuard", () => {
  it("runs on every route, before the route's own guards", async () => {
    calls.length = 0;

    @Injectable()
    @GlobalGuard()
    class Everywhere implements CanActivate {
      canActivate(): boolean {
        calls.push("global");
        return true;
      }
    }

    @Injectable()
    class OnClass implements CanActivate {
      canActivate(): boolean {
        calls.push("class");
        return true;
      }
    }

    @Injectable()
    class OnMethod implements CanActivate {
      canActivate(): boolean {
        calls.push("method");
        return true;
      }
    }

    @Controller("a")
    @UseGuards(OnClass)
    class A {
      @Get("x")
      @UseGuards(OnMethod)
      x() {
        return {};
      }
    }

    @Controller("b")
    class B {
      @Get("y")
      y() {
        return {};
      }
    }

    const app = await appWith([Everywhere, OnClass, OnMethod], [A, B]);
    await get(app, "/a/x");
    await get(app, "/b/y");

    expect(calls).toEqual(["global", "class", "method", "global"]);
  });

  it("can deny: returning false is a 403, and an exception keeps its own status", async () => {
    @Injectable()
    @GlobalGuard()
    class Denies implements CanActivate {
      canActivate(context: ExecutionContext): boolean {
        if (context.request.headers.get("x-mode") === "401") {
          throw new UnauthorizedException("no token");
        }
        return context.request.headers.get("x-mode") !== "deny";
      }
    }

    @Controller("c")
    class C {
      @Get("z")
      z() {
        return { ok: true };
      }
    }

    const app = await appWith([Denies], [C]);

    expect((await get(app, "/c/z")).status).toBe(200);
    expect((await app.handle(new Request("http://localhost/c/z", { headers: { "x-mode": "deny" } }))).status).toBe(403);
    expect((await app.handle(new Request("http://localhost/c/z", { headers: { "x-mode": "401" } }))).status).toBe(401);
  });

  it("a denial stops the request: the route's own guards and handler never run", async () => {
    calls.length = 0;

    @Injectable()
    @GlobalGuard()
    class Blocks implements CanActivate {
      canActivate(): boolean {
        throw new ForbiddenException("blocked");
      }
    }

    @Injectable()
    class Later implements CanActivate {
      canActivate(): boolean {
        calls.push("later");
        return true;
      }
    }

    @Controller("d")
    @UseGuards(Later)
    class D {
      @Get("w")
      w() {
        calls.push("handler");
        return {};
      }
    }

    const res = await get(await appWith([Blocks, Later], [D]), "/d/w");

    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("several global guards run in dependency order", async () => {
    calls.length = 0;

    @Injectable()
    @GlobalGuard()
    class First implements CanActivate {
      canActivate(): boolean {
        calls.push("first");
        return true;
      }
    }

    @Injectable()
    @GlobalGuard()
    class Second implements CanActivate {
      constructor(readonly first: First) {}
      canActivate(): boolean {
        calls.push("second");
        return true;
      }
    }

    @Controller("e")
    class E {
      @Get("v")
      v() {
        return {};
      }
    }

    // Registered in the "wrong" order on purpose: Second depends on First.
    await get(await appWith([Second, First], [E]), "/e/v");

    expect(calls).toEqual(["first", "second"]);
  });

  it("a guard that is not marked global is not applied globally", async () => {
    calls.length = 0;

    @Injectable()
    class Plain implements CanActivate {
      canActivate(): boolean {
        calls.push("plain");
        return false;
      }
    }

    @Controller("f")
    class F {
      @Get("u")
      u() {
        return { ok: true };
      }
    }

    const res = await get(await appWith([Plain], [F]), "/f/u");

    expect(res.status).toBe(200);
    expect(calls).toEqual([]);
  });

  it("a marked guard that is not registered as a provider has no effect", async () => {
    @Injectable()
    @GlobalGuard()
    class Forgotten implements CanActivate {
      canActivate(): boolean {
        return false;
      }
    }

    @Controller("g")
    class G {
      @Get("t")
      t() {
        return { ok: true };
      }
    }

    expect(Forgotten).toBeDefined();
    expect((await get(await appWith([], [G]), "/g/t")).status).toBe(200);
  });

  it("fails boot, naming the class, when a global guard has no canActivate()", async () => {
    @Injectable()
    @GlobalGuard()
    class NotAGuard {}

    @Controller("h")
    class H {
      @Get("s")
      s() {
        return {};
      }
    }

    await expect(appWith([NotAGuard], [H])).rejects.toThrow("NotAGuard is marked @GlobalGuard() but has no canActivate() method.");
  });
});

/** Runs one request through a global guard that records what `getRouteMetadata` returns for the matched route. */
async function readMetadata(controller: new () => object, path: string, key: symbol = KEY): Promise<unknown> {
  let value: unknown = "unset";

  @Injectable()
  @GlobalGuard()
  class Reader implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      value = getRouteMetadata(key, context);
      return true;
    }
  }

  await get(await appWith([Reader], [controller]), path);
  return value;
}

describe("SetRouteMetadata / getRouteMetadata", () => {
  it("reads a value set on the method", async () => {
    @Controller("m1")
    class M1 {
      @Get("a")
      @SetRouteMetadata(KEY, "method")
      a() {
        return {};
      }
    }

    expect(await readMetadata(M1, "/m1/a")).toBe("method");
  });

  it("falls back to the controller's value, and a method value overrides it", async () => {
    @Controller("m2")
    @SetRouteMetadata(KEY, "class")
    class M2 {
      @Get("inherits")
      inherits() {
        return {};
      }

      @Get("overrides")
      @SetRouteMetadata(KEY, "method")
      overrides() {
        return {};
      }
    }

    expect(await readMetadata(M2, "/m2/inherits")).toBe("class");
    expect(await readMetadata(M2, "/m2/overrides")).toBe("method");
  });

  it("is undefined when nothing was set, and keys don't collide", async () => {
    @Controller("m3")
    @SetRouteMetadata(KEY, "only-key")
    class M3 {
      @Get("a")
      a() {
        return {};
      }
    }

    expect(await readMetadata(M3, "/m3/a", OTHER)).toBeUndefined();
  });
});
