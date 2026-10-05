import type { HttpMethod } from "./types.js";

export interface RouteFound<T> {
  kind: "found";
  handler: T;
  params: Record<string, string>;
}

export interface RouteNotFound {
  kind: "not-found";
}

export interface RouteMethodNotAllowed {
  kind: "method-not-allowed";
  allowed: HttpMethod[];
}

export type RouteLookupResult<T> = RouteFound<T> | RouteNotFound | RouteMethodNotAllowed;

export class DuplicateRouteError extends Error {
  override readonly name = "DuplicateRouteError";

  constructor(method: HttpMethod, path: string) {
    super(`Duplicate route: ${method} ${path} is already registered — each method+path pair must be unique.`);
  }
}

/** Thrown by `Router.match` for a path containing a broken `%` escape (`/a/100%`, `/a/%E0%A4%A`), which can't be decoded. */
export class MalformedPathError extends Error {
  override readonly name = "MalformedPathError";

  constructor(path: string) {
    super(`Malformed percent-encoding in path: ${path}`);
  }
}

/**
 * A route's handler together with the names of its own `:param` segments (and `*`), in path order. Names belong
 * to the route, not to the trie node: `GET /posts/:id` and `DELETE /posts/:postId` share a node for the segment
 * but each handler must see its value under its own name.
 */
interface RouteEntry<T> {
  handler: T;
  paramNames: readonly string[];
}

interface TrieNode<T> {
  staticChildren: Map<string, TrieNode<T>>;
  paramChild?: TrieNode<T>;
  wildcardChild?: TrieNode<T>;
  routes: Map<HttpMethod, RouteEntry<T>>;
}

function createNode<T>(): TrieNode<T> {
  return { staticChildren: new Map(), routes: new Map() };
}

function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

/**
 * Decodes one path segment, once. `%2F` stays inside the segment as a `/` (the path was already split), `+` is left
 * alone (it only means a space in a query string), and `%2520` becomes the text `%20`, not a space.
 */
function decodeSegment(segment: string, path: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new MalformedPathError(path);
  }
}

interface WalkResult<T> {
  node: TrieNode<T>;
  /** The captured values in path order: one per `:param` segment, then the wildcard's rest if there is one. */
  values: string[];
}

/**
 * Depth-first with backtracking: a static/param branch that leads to a dead
 * end (no route registered there) must not block a sibling branch — e.g.
 * `/posts/new` (static, POST only) must not swallow `/posts/:id` (GET) when
 * someone requests GET /posts/new.
 */
function walk<T>(node: TrieNode<T>, segments: readonly string[], index: number, values: readonly string[]): WalkResult<T> | undefined {
  if (index === segments.length) {
    return node.routes.size > 0 ? { node, values: [...values] } : undefined;
  }

  const segment = segments[index] as string;

  const staticChild = node.staticChildren.get(segment);
  if (staticChild) {
    const result = walk(staticChild, segments, index + 1, values);
    if (result) {
      return result;
    }
  }

  if (node.paramChild) {
    const result = walk(node.paramChild, segments, index + 1, [...values, segment]);
    if (result) {
      return result;
    }
  }

  if (node.wildcardChild && node.wildcardChild.routes.size > 0) {
    return { node: node.wildcardChild, values: [...values, segments.slice(index).join("/")] };
  }

  return undefined;
}

/**
 * A path router keyed on an opaque handler type `T` — this package plugs in
 * controller method references; tests plug in plain strings.
 */
export class Router<T> {
  readonly #root = createNode<T>();

  add(method: HttpMethod, path: string, handler: T): void {
    const segments = splitPath(path);
    const paramNames: string[] = [];
    let node = this.#root;

    for (const segment of segments) {
      if (segment.startsWith(":")) {
        paramNames.push(segment.slice(1));
        node.paramChild ??= createNode();
        node = node.paramChild;
      } else if (segment === "*") {
        paramNames.push("*");
        node.wildcardChild ??= createNode();
        node = node.wildcardChild;
      } else {
        let child = node.staticChildren.get(segment);
        if (!child) {
          child = createNode();
          node.staticChildren.set(segment, child);
        }
        node = child;
      }
    }

    if (node.routes.has(method)) {
      throw new DuplicateRouteError(method, path);
    }
    node.routes.set(method, { handler, paramNames });
  }

  /** Matches the percent-encoded path as it arrives; throws `MalformedPathError` if a segment can't be decoded. */
  match(method: HttpMethod, path: string): RouteLookupResult<T> {
    const segments = splitPath(path).map((segment) => decodeSegment(segment, path));
    const result = walk(this.#root, segments, 0, []);

    if (!result) {
      return { kind: "not-found" };
    }

    const route = result.node.routes.get(method);
    if (!route) {
      return { kind: "method-not-allowed", allowed: [...result.node.routes.keys()] };
    }

    // Names come from the matched route itself, so a path position shared with another method's route can't rename them.
    const params = Object.fromEntries(route.paramNames.map((name, position) => [name, result.values[position] ?? ""]));
    return { kind: "found", handler: route.handler, params };
  }
}
