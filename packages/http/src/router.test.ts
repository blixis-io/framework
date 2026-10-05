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

describe("Router: param names belong to the route, not the path position", () => {
  it("gives each method its own param name when two routes share a path position", () => {
    const router = new Router<string>();
    router.add("GET", "/posts/:id", "get");
    router.add("DELETE", "/posts/:postId", "delete");

    expect(router.match("GET", "/posts/5")).toEqual({ kind: "found", handler: "get", params: { id: "5" } });
    expect(router.match("DELETE", "/posts/5")).toEqual({ kind: "found", handler: "delete", params: { postId: "5" } });
  });

  it("keeps the names apart for routes that diverge deeper in the path", () => {
    const router = new Router<string>();
    router.add("GET", "/orgs/:orgId/members", "members");
    router.add("GET", "/orgs/:slug/settings", "settings");

    expect(router.match("GET", "/orgs/acme/members")).toEqual({ kind: "found", handler: "members", params: { orgId: "acme" } });
    expect(router.match("GET", "/orgs/acme/settings")).toEqual({ kind: "found", handler: "settings", params: { slug: "acme" } });
  });

  it("names several params and a wildcard per route", () => {
    const router = new Router<string>();
    router.add("GET", "/files/:bucket/:key/*", "get-file");
    router.add("PUT", "/files/:b/:k/*", "put-file");

    expect(router.match("PUT", "/files/media/cover/a/b.png")).toEqual({
      kind: "found",
      handler: "put-file",
      params: { b: "media", k: "cover", "*": "a/b.png" },
    });
    expect(router.match("GET", "/files/media/cover/a/b.png")).toEqual({
      kind: "found",
      handler: "get-file",
      params: { bucket: "media", key: "cover", "*": "a/b.png" },
    });
  });

  it("still rejects the same method on the same path, whatever the param is called", () => {
    const router = new Router<string>();
    router.add("GET", "/posts/:id", "a");

    expect(() => router.add("GET", "/posts/:postId", "b")).toThrow(DuplicateRouteError);
  });
});

describe("Router: percent-encoded paths", () => {
  it("decodes a param value", () => {
    const router = new Router<string>();
    router.add("GET", "/posts/:id", "post");

    expect(router.match("GET", "/posts/hello%20world")).toEqual({ kind: "found", handler: "post", params: { id: "hello world" } });
    expect(router.match("GET", "/posts/caf%C3%A9")).toEqual({ kind: "found", handler: "post", params: { id: "café" } });
  });

  it("keeps an encoded slash inside one param instead of splitting the segment", () => {
    const router = new Router<string>();
    router.add("GET", "/posts/:id", "post");

    expect(router.match("GET", "/posts/a%2Fb")).toEqual({ kind: "found", handler: "post", params: { id: "a/b" } });
  });

  it("decodes once: %2520 is the text %20, not a space", () => {
    const router = new Router<string>();
    router.add("GET", "/posts/:id", "post");

    expect(router.match("GET", "/posts/100%2520")).toEqual({ kind: "found", handler: "post", params: { id: "100%20" } });
  });

  it("leaves + alone: it is only a space in a query string", () => {
    const router = new Router<string>();
    router.add("GET", "/posts/:id", "post");

    expect(router.match("GET", "/posts/a+b")).toEqual({ kind: "found", handler: "post", params: { id: "a+b" } });
  });

  it("matches a static segment written with non-ASCII characters against its encoded form", () => {
    const router = new Router<string>();
    router.add("GET", "/café/menu", "menu");

    expect(router.match("GET", "/caf%C3%A9/menu")).toEqual({ kind: "found", handler: "menu", params: {} });
  });

  it("decodes each segment of a wildcard capture", () => {
    const router = new Router<string>();
    router.add("GET", "/files/*", "file");

    expect(router.match("GET", "/files/my%20dir/a%20b.txt")).toEqual({ kind: "found", handler: "file", params: { "*": "my dir/a b.txt" } });
  });

  it("reports malformed-path for a broken escape sequence, instead of passing it on or matching", () => {
    const router = new Router<string>();
    router.add("GET", "/posts/:id", "post");

    expect(router.match("GET", "/posts/%E0%A4%A")).toEqual({ kind: "malformed-path" });
    expect(router.match("GET", "/posts/100%")).toEqual({ kind: "malformed-path" });
    expect(router.match("GET", "/%zz/posts/1")).toEqual({ kind: "malformed-path" });
  });
});
