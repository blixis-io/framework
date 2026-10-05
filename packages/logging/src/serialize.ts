/** What replaces the value of a redacted key. */
export const REDACTED = "[REDACTED]";

/**
 * Key names that usually hold a secret, as a starting point for `redact`. Matching is by whole name, ignoring case,
 * so `tokens` or `passwordHint` are not caught: list those too if they hold secrets in your app.
 */
export const COMMON_SECRET_KEYS = [
  "password",
  "passwd",
  "pwd",
  "secret",
  "client_secret",
  "clientsecret",
  "token",
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "id_token",
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "api-key",
  "api_key",
  "apikey",
  "x-api-key",
] as const;

/** Deeper than this is written as `[Object]` or `[Array]`: a log line is not the place for a whole object graph. */
const MAX_DEPTH = 8;

function isRecordLike(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** The value of `object[key]`, or a note when reading it throws (a hostile or half-built getter). */
function read(object: object, key: PropertyKey): unknown {
  try {
    return Reflect.get(object, key);
  } catch (error) {
    return `[Unreadable: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

/**
 * A copy of `value` made only of things `JSON.stringify` accepts, so logging it can't throw or silently lose data:
 * an `Error` keeps its name, message, stack, cause and own properties (plain `JSON.stringify` writes `{}`), a circular
 * reference becomes `"[Circular]"`, a `BigInt` becomes text, functions and symbols are described, `Map` and `Set`
 * become arrays, and `toJSON()` is honoured (so a `Date` is an ISO string). The input is never changed.
 *
 * `redact` lists key names whose values are replaced with `"[REDACTED]"` at any depth, whatever their type, compared
 * by whole name and ignoring case.
 */
export function toJsonSafe(value: unknown, redact?: readonly string[]): unknown {
  const redacted = new Set((redact ?? []).map((key) => key.toLowerCase()));

  function walk(current: unknown, depth: number, ancestors: readonly object[]): unknown {
    switch (typeof current) {
      case "bigint":
        return String(current);
      case "symbol":
        return String(current);
      case "function":
        return `[Function: ${current.name === "" ? "anonymous" : current.name}]`;
      default:
        break;
    }
    if (!isRecordLike(current)) {
      return current;
    }
    if (ancestors.includes(current)) {
      return "[Circular]";
    }
    if (depth >= MAX_DEPTH) {
      return Array.isArray(current) ? "[Array]" : "[Object]";
    }
    const path = [...ancestors, current];

    if (current instanceof Error) {
      return walkError(current, depth, path);
    }
    if (Array.isArray(current)) {
      return current.map((item) => walk(item, depth + 1, path));
    }
    if (current instanceof Map) {
      return [...current].map((entry) => walk(entry, depth + 1, path));
    }
    if (current instanceof Set) {
      return [...current].map((item) => walk(item, depth + 1, path));
    }
    const toJSON = read(current, "toJSON");
    if (typeof toJSON === "function") {
      try {
        const converted: unknown = Reflect.apply(toJSON, current, []);
        return converted === current ? walkProperties(current, depth, path) : walk(converted, depth + 1, path);
      } catch (error) {
        return `[Unserializable: ${error instanceof Error ? error.message : String(error)}]`;
      }
    }
    return walkProperties(current, depth, path);
  }

  function walkProperties(object: object, depth: number, path: readonly object[], into: Record<string, unknown> = {}): Record<string, unknown> {
    for (const key of Object.keys(object)) {
      into[key] = redacted.has(key.toLowerCase()) ? REDACTED : walk(read(object, key), depth + 1, path);
    }
    return into;
  }

  function walkError(error: Error, depth: number, path: readonly object[]): Record<string, unknown> {
    const out: Record<string, unknown> = { name: error.name, message: error.message, stack: error.stack };
    // `cause` and an AggregateError's `errors` are own properties but not enumerable, so Object.keys misses them.
    if ("cause" in error) {
      out["cause"] = walk(error.cause, depth + 1, path);
    }
    if (error instanceof AggregateError) {
      out["errors"] = error.errors.map((inner: unknown) => walk(inner, depth + 1, path));
    }
    return walkProperties(error, depth, path, out);
  }

  return walk(value, 0, []);
}

/** `toJsonSafe` for a context object, which stays an object: what a logger hands its transports when `redact` is set. */
export function redactRecord(record: Record<string, unknown>, redact: readonly string[]): Record<string, unknown> {
  const safe = toJsonSafe(record, redact);
  return isRecordLike(safe) && !Array.isArray(safe) ? Object.fromEntries(Object.entries(safe)) : {};
}

/** `JSON.stringify` that does not throw and does not lose errors: see `toJsonSafe`. */
export function safeStringify(value: unknown, redact?: readonly string[]): string {
  try {
    return JSON.stringify(toJsonSafe(value, redact)) ?? String(value);
  } catch (error) {
    return `"[Unserializable: ${error instanceof Error ? error.message : String(error)}]"`;
  }
}
