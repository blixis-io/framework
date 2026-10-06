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

/** A segment of the path has a broken `%` escape (`/a/100%`, `/a/%E0%A4%A`) and can't be decoded, so no route is looked up. */
export interface RouteMalformedPath {
  kind: "malformed-path";
}

export type RouteLookupResult<T> = RouteFound<T> | RouteNotFound | RouteMethodNotAllowed | RouteMalformedPath;

export class DuplicateRouteError extends Error {
  override readonly name = "DuplicateRouteError";

  constructor(method: HttpMethod, path: string) {
    super(`Duplicate route: ${method} ${path} is already registered — each method+path pair must be unique.`);
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
function decodeSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

interface WalkResult<T> {
  route: RouteEntry<T>;
  /** The captured values in path order: one per `:param` segment, then the wildcard's rest if there is one. */
  values: string[];
}

/**
 * Depth-first with backtracking, static before param before wildcard. A branch only counts as a match when it has a
 * route for the requested method: `/posts/new` (static, POST only) must not swallow `GET /posts/new` when
 * `GET /posts/:id` exists. Every branch that matched the path but not the method adds its methods to `allowed`, so a
 * request nothing can serve gets a 405 listing what the path does accept, and one that matched no path gets a 404.
 */
function walk<T>(
  node: TrieNode<T>,
  segments: readonly string[],
  index: number,
  values: readonly string[],
  method: HttpMethod,
  allowed: Set<HttpMethod>,
): WalkResult<T> | undefined {
  if (index === segments.length) {
    return endAt(node, [...values], method, allowed);
  }

  const segment = segments[index] as string;

  const staticChild = node.staticChildren.get(segment);
  if (staticChild) {
    const result = walk(staticChild, segments, index + 1, values, method, allowed);
    if (result) {
      return result;
    }
  }

  if (node.paramChild) {
    const result = walk(node.paramChild, segments, index + 1, [...values, segment], method, allowed);
    if (result) {
      return result;
    }
  }

  if (node.wildcardChild) {
    return endAt(node.wildcardChild, [...values, segments.slice(index).join("/")], method, allowed);
  }

  return undefined;
}

/** The route `node` has for `method`, or `undefined` after noting the methods it does have (a node with no routes is only a prefix). */
function endAt<T>(node: TrieNode<T>, values: string[], method: HttpMethod, allowed: Set<HttpMethod>): WalkResult<T> | undefined {
  const route = node.routes.get(method);
  if (route) {
    return { route, values };
  }
  for (const other of node.routes.keys()) {
    allowed.add(other);
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

  /** Matches the percent-encoded path as it arrives. A segment that can't be decoded gives `malformed-path`. */
  match(method: HttpMethod, path: string): RouteLookupResult<T> {
    const decoded = splitPath(path).map(decodeSegment);
    const segments = decoded.filter((segment) => segment !== undefined);
    if (segments.length !== decoded.length) {
      return { kind: "malformed-path" };
    }
    const allowed = new Set<HttpMethod>();
    const result = walk(this.#root, segments, 0, [], method, allowed);

    if (!result) {
      return allowed.size > 0 ? { kind: "method-not-allowed", allowed: [...allowed] } : { kind: "not-found" };
    }

    // Names come from the matched route itself, so a path position shared with another method's route can't rename them.
    // One value was captured per name along this route's own path, so every position is filled.
    const params = Object.fromEntries(result.route.paramNames.map((name, position) => [name, result.values[position] as string]));
    return { kind: "found", handler: result.route.handler, params };
  }
}
