import { describe, expect, it } from "vitest";
import { DuplicateRouteError, Router } from "./router.js";

describe("Router: static routes", () => {
  it("matches an exact static path", () => {
    const router = new Router<string>();
    router.add("GET", "/posts", "list-posts");

    const result = router.match("GET", "/posts");

    expect(result).toEqual({ kind: "found", handler: "list-posts", params: {} });
  });

  it("matches the root path", () => {
    const router = new Router<string>();
    router.add("GET", "/", "root");

    expect(router.match("GET", "/")).toEqual({ kind: "found", handler: "root", params: {} });
  });

  it("treats leading/trailing slashes as insignificant", () => {
    const router = new Router<string>();
    router.add("GET", "posts/all", "list");

    expect(router.match("GET", "/posts/all/")).toEqual({ kind: "found", handler: "list", params: {} });
  });
});

describe("Router: param routes", () => {
  it("matches a :param segment and extracts its value", () => {
    const router = new Router<string>();
    router.add("GET", "/posts/:id", "get-post");

    expect(router.match("GET", "/posts/42")).toEqual({
      kind: "found",
      handler: "get-post",
      params: { id: "42" },
    });
  });

  it("extracts multiple params across segments", () => {
    const router = new Router<string>();
    router.add("GET", "/posts/:postId/comments/:commentId", "get-comment");

    expect(router.match("GET", "/posts/1/comments/2")).toEqual({
      kind: "found",
      handler: "get-comment",
      params: { postId: "1", commentId: "2" },
    });
  });
});

describe("Router: wildcard routes", () => {
  it("matches a trailing * and captures the rest of the path", () => {
    const router = new Router<string>();
    router.add("GET", "/assets/*", "serve-asset");

    expect(router.match("GET", "/assets/img/logo.png")).toEqual({
      kind: "found",
      handler: "serve-asset",
      params: { "*": "img/logo.png" },
    });
  });
});

describe("Router: precedence", () => {
  it("prefers a static match over a param match for the same segment", () => {
    const router = new Router<string>();
    router.add("GET", "/posts/new", "new-post-form");
    router.add("GET", "/posts/:id", "get-post");

    expect(router.match("GET", "/posts/new")).toEqual({
      kind: "found",
      handler: "new-post-form",
      params: {},
    });
    expect(router.match("GET", "/posts/42")).toEqual({
      kind: "found",
      handler: "get-post",
      params: { id: "42" },
    });
  });

  it("prefers a param match over a wildcard match", () => {
    const router = new Router<string>();
    router.add("GET", "/posts/:id", "get-post");
    router.add("GET", "/posts/*", "catch-all");

    expect(router.match("GET", "/posts/42")).toEqual({
      kind: "found",
      handler: "get-post",
      params: { id: "42" },
    });
    expect(router.match("GET", "/posts/42/extra")).toEqual({
      kind: "found",
      handler: "catch-all",
      params: { "*": "42/extra" },
    });
  });
});

describe("Router: method handling", () => {
  it("registers multiple methods on the same path independently", () => {
    const router = new Router<string>();
    router.add("GET", "/posts", "list-posts");
    router.add("POST", "/posts", "create-post");

    expect(router.match("GET", "/posts")).toMatchObject({ handler: "list-posts" });
    expect(router.match("POST", "/posts")).toMatchObject({ handler: "create-post" });
  });

  it("returns method-not-allowed with the Allow list when the path matches but the method doesn't", () => {
    const router = new Router<string>();
    router.add("GET", "/posts", "list-posts");
    router.add("POST", "/posts", "create-post");

    const result = router.match("DELETE", "/posts");

    expect(result.kind).toBe("method-not-allowed");
    expect(result.kind === "method-not-allowed" && result.allowed.toSorted()).toEqual(["GET", "POST"]);
  });

  it("throws DuplicateRouteError when the same method+path is registered twice, instead of silently replacing the handler", () => {
    const router = new Router<string>();
    router.add("GET", "/posts", "list-posts");

    expect(() => router.add("GET", "/posts", "list-posts-again")).toThrow(DuplicateRouteError);
    expect(router.match("GET", "/posts")).toMatchObject({ handler: "list-posts" });
  });
});

describe("Router: not found", () => {
  it("returns not-found for a path with no matching route at all", () => {
    const router = new Router<string>();
    router.add("GET", "/posts", "list-posts");

    expect(router.match("GET", "/comments")).toEqual({ kind: "not-found" });
  });

  it("returns not-found for an intermediate path segment that has no route of its own", () => {
    const router = new Router<string>();
    router.add("GET", "/posts/:id", "get-post");

    expect(router.match("GET", "/posts")).toEqual({ kind: "not-found" });
  });

  it("returns not-found when a wildcard segment exists only as a prefix for a deeper route", () => {
    const router = new Router<string>();
    router.add("GET", "/files/*/extra", "get-extra");

    expect(router.match("GET", "/files/onlyone")).toEqual({ kind: "not-found" });
  });
});
