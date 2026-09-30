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

interface TrieNode<T> {
  staticChildren: Map<string, TrieNode<T>>;
  paramChild?: { name: string; node: TrieNode<T> };
  wildcardChild?: { name: string; node: TrieNode<T> };
  handlers: Map<HttpMethod, T>;
}

function createNode<T>(): TrieNode<T> {
  return { staticChildren: new Map(), handlers: new Map() };
}

function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

interface WalkResult<T> {
  node: TrieNode<T>;
  params: Record<string, string>;
}

/**
 * Depth-first with backtracking: a static/param branch that leads to a dead
 * end (no route registered there) must not block a sibling branch — e.g.
 * `/posts/new` (static, POST only) must not swallow `/posts/:id` (GET) when
 * someone requests GET /posts/new.
 */
function walk<T>(
  node: TrieNode<T>,
  segments: readonly string[],
  index: number,
  params: Record<string, string>,
): WalkResult<T> | undefined {
  if (index === segments.length) {
    return node.handlers.size > 0 ? { node, params } : undefined;
  }

  const segment = segments[index] as string;

  const staticChild = node.staticChildren.get(segment);
  if (staticChild) {
    const result = walk(staticChild, segments, index + 1, params);
    if (result) {
      return result;
    }
  }

  if (node.paramChild) {
    const { name, node: paramNode } = node.paramChild;
    const result = walk(paramNode, segments, index + 1, { ...params, [name]: segment });
    if (result) {
      return result;
    }
  }

  if (node.wildcardChild) {
    const { name, node: wildcardNode } = node.wildcardChild;
    if (wildcardNode.handlers.size > 0) {
      return { node: wildcardNode, params: { ...params, [name]: segments.slice(index).join("/") } };
    }
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
    let node = this.#root;

    for (const segment of segments) {
      if (segment.startsWith(":")) {
        const name = segment.slice(1);
        node.paramChild ??= { name, node: createNode() };
        node = node.paramChild.node;
      } else if (segment === "*") {
        node.wildcardChild ??= { name: "*", node: createNode() };
        node = node.wildcardChild.node;
      } else {
        let child = node.staticChildren.get(segment);
        if (!child) {
          child = createNode();
          node.staticChildren.set(segment, child);
        }
        node = child;
      }
    }

    if (node.handlers.has(method)) {
      throw new DuplicateRouteError(method, path);
    }
    node.handlers.set(method, handler);
  }

  match(method: HttpMethod, path: string): RouteLookupResult<T> {
    const segments = splitPath(path);
    const result = walk(this.#root, segments, 0, {});

    if (!result) {
      return { kind: "not-found" };
    }

    const handler = result.node.handlers.get(method);
    if (!handler) {
      return { kind: "method-not-allowed", allowed: [...result.node.handlers.keys()] };
    }

    return { kind: "found", handler, params: result.params };
  }
}
