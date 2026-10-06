import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Router, type RouteLookupResult } from "./router.js";
import type { HttpMethod } from "./types.js";

/**
 * The router against a brute-force model of what the documentation says it does: a route matches a path
 * segment by segment (a static segment equals, `:param` takes any one segment, `*` takes the rest, at least
 * one segment), the winner is the route that is static before param before wildcard at the first segment
 * where two differ, and only routes registered for the requested method can win. A request nothing serves is
 * a 405 listing the methods of every route that matches the path, or a 404 when none does.
 */

type Segment = { kind: "static"; value: string } | { kind: "param"; name: string } | { kind: "wildcard" };
interface ModelRoute {
  method: HttpMethod;
  segments: Segment[];
  handler: string;
}

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE"];
const WORDS = ["a", "b", "c"];
const REQUEST_WORDS = [...WORDS, "zz"];
const PRIORITY = { static: 0, param: 1, wildcard: 2 } as const;

const staticSegment = fc.constantFrom(...WORDS).map((value): Segment => ({ kind: "static", value }));
const paramSegment = fc.constantFrom("id", "slug", "x").map((name): Segment => ({ kind: "param", name }));

/** 1 to 3 segments; a wildcard, if any, only last, as the router documents. */
const routeSegments = fc
  .tuple(fc.array(fc.oneof(staticSegment, paramSegment), { minLength: 0, maxLength: 2 }), fc.boolean(), fc.oneof(staticSegment, paramSegment))
  .map(([head, endsWithWildcard, last]): Segment[] => [...head, endsWithWildcard ? { kind: "wildcard" } : last]);

/** The shape of a route ignoring param names: two routes with the same method and shape would be a duplicate. */
const shape = (route: Pick<ModelRoute, "method" | "segments">): string =>
  `${route.method} ${route.segments.map((segment) => (segment.kind === "static" ? `s:${segment.value}` : segment.kind === "param" ? "p" : "w")).join("/")}`;

const routeSet = fc
  .array(fc.record({ method: fc.constantFrom(...METHODS), segments: routeSegments }), { minLength: 1, maxLength: 8 })
  .map((routes) => {
    const seen = new Set<string>();
    return routes
      .filter((route) => !seen.has(shape(route)) && seen.add(shape(route)))
      .map((route, index): ModelRoute => ({ ...route, handler: `h${index}` }));
  });

const requestPath = fc.array(fc.constantFrom(...REQUEST_WORDS), { minLength: 0, maxLength: 4 });
const requestMethod = fc.constantFrom(...METHODS);

function structurallyMatches(route: ModelRoute, path: string[]): boolean {
  for (const [index, segment] of route.segments.entries()) {
    if (segment.kind === "wildcard") {
      return path.length > index;
    }
    if (index >= path.length || (segment.kind === "static" && segment.value !== path[index])) {
      return false;
    }
  }
  return route.segments.length === path.length;
}

/** Lower is more specific: compare segment by segment, static before param before wildcard. */
function compareSpecificity(left: ModelRoute, right: ModelRoute): number {
  for (let index = 0; index < Math.max(left.segments.length, right.segments.length); index += 1) {
    const l = left.segments[index];
    const r = right.segments[index];
    if (l === undefined || r === undefined || l.kind === r.kind) {
      continue;
    }
    return PRIORITY[l.kind] - PRIORITY[r.kind];
  }
  return 0;
}

function expected(routes: ModelRoute[], method: HttpMethod, path: string[]): RouteLookupResult<string> {
  const matching = routes.filter((route) => structurallyMatches(route, path));
  const winner = matching.filter((route) => route.method === method).toSorted(compareSpecificity)[0];
  if (winner) {
    const params: Record<string, string> = {};
    winner.segments.forEach((segment, index) => {
      if (segment.kind === "param") {
        params[segment.name] = path[index] ?? "";
      } else if (segment.kind === "wildcard") {
        params["*"] = path.slice(index).join("/");
      }
    });
    return { kind: "found", handler: winner.handler, params };
  }
  if (matching.length === 0) {
    return { kind: "not-found" };
  }
  return { kind: "method-not-allowed", allowed: [...new Set(matching.map((route) => route.method))].toSorted() };
}

function build(routes: ModelRoute[]): Router<string> {
  const router = new Router<string>();
  for (const route of routes) {
    const path = `/${route.segments.map((segment) => (segment.kind === "static" ? segment.value : segment.kind === "param" ? `:${segment.name}` : "*")).join("/")}`;
    router.add(route.method, path, route.handler);
  }
  return router;
}

const normalize = (result: RouteLookupResult<string>): RouteLookupResult<string> =>
  result.kind === "method-not-allowed" ? { kind: "method-not-allowed", allowed: result.allowed.toSorted() } : result;

describe("Router against a brute-force model", () => {
  it("answers every request the way the model does: the winner, a 405 with the right Allow, or a 404", () => {
    fc.assert(
      fc.property(routeSet, requestMethod, requestPath, (routes, method, path) => {
        const actual = normalize(build(routes).match(method, `/${path.join("/")}`));

        expect(actual).toEqual(expected(routes, method, path));
      }),
      { numRuns: 3000 },
    );
  });

  it("does not depend on the order the routes were registered in", () => {
    fc.assert(
      fc.property(routeSet, fc.nat(), requestMethod, requestPath, (routes, seed, method, path) => {
        const shuffled = routes.toSorted((left, right) => ((left.handler.charCodeAt(1) * 31 + seed) % 7) - ((right.handler.charCodeAt(1) * 31 + seed) % 7));
        const request = `/${path.join("/")}`;

        expect(normalize(build(shuffled).match(method, request))).toEqual(normalize(build(routes).match(method, request)));
      }),
      { numRuns: 1500 },
    );
  });

  it("never answers 405 for a request some registered route serves", () => {
    fc.assert(
      fc.property(routeSet, requestMethod, requestPath, (routes, method, path) => {
        const servable = routes.some((route) => route.method === method && structurallyMatches(route, path));

        const result = build(routes).match(method, `/${path.join("/")}`);

        expect(servable).toBe(result.kind === "found");
      }),
      { numRuns: 2000 },
    );
  });
});

describe("Router: paths of any shape", () => {
  it("always answers with one of the four documented results, whatever the path", () => {
    const router = new Router<string>();
    router.add("GET", "/files/*", "files");
    router.add("GET", "/users/:id", "user");
    router.add("POST", "/users", "create");

    fc.assert(
      fc.property(fc.string({ unit: "binary-ascii", maxLength: 40 }), fc.constantFrom(...METHODS), (path, method) => {
        const result = router.match(method, path);

        expect(["found", "not-found", "method-not-allowed", "malformed-path"]).toContain(result.kind);
      }),
      { numRuns: 3000 },
    );
  });

  it("hands a param exactly what the client encoded, once decoded", () => {
    const router = new Router<string>();
    router.add("GET", "/things/:value", "thing");

    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 30 }), (value) => {
        const result = router.match("GET", `/things/${encodeURIComponent(value)}`);

        expect(result).toEqual({ kind: "found", handler: "thing", params: { value } });
      }),
      { numRuns: 2000 },
    );
  });

  it("decodes only once: an encoded percent sign comes back as text, never a second decode", () => {
    const router = new Router<string>();
    router.add("GET", "/things/:value", "thing");

    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), (value) => {
        const twice = encodeURIComponent(encodeURIComponent(value));

        expect(router.match("GET", `/things/${twice}`)).toEqual({ kind: "found", handler: "thing", params: { value: encodeURIComponent(value) } });
      }),
      { numRuns: 1500 },
    );
  });

  it("answers malformed-path for a percent sign not followed by two hex digits, wherever it sits in a segment", () => {
    const router = new Router<string>();
    router.add("GET", "/things/:value", "thing");

    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{0,5}$/), fc.stringMatching(/^[g-z]{0,5}$/), (before, after) => {
        expect(router.match("GET", `/things/${before}%${after}`).kind).toBe("malformed-path");
      }),
      { numRuns: 1000 },
    );
  });
});
