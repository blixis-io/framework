---
title: "@blixis/http"
description: Full API reference for the HTTP layer — routing, controllers, validation, guards, errors.
sidebar:
  order: 3
---

Routing, controller/param/guard decorators, Zod-backed validation, RFC 9457 errors, and the Node adapter. See [Routing & Controllers](/concepts/routing-controllers/), [Request Validation](/concepts/request-validation/), [Guards & Authorization](/concepts/guards-and-authorization/), and [Error Handling](/concepts/error-handling/) for the concepts.

## Application

### `createHttpApplication` / `HttpApplication`

```ts
function createHttpApplication(rootModule: ModuleRef, options?: HttpApplicationOptions): Promise<HttpApplication>;

type HttpApplicationOptions = HandlerOptions & CreateApplicationOptions; // bodyLimit + overrides

class HttpApplication {
  get<T>(token: Token<T>): T;
  handle(request: Request): Promise<Response>;
  listen(port: number, hostname?: string): Promise<ListenHandle>; // hostname defaults to "0.0.0.0"
  close(signal?: string): Promise<void>;
}

interface ListenHandle {
  port: number; // the actually-bound port, useful when you pass 0
}
```

Wraps `@blixis/core`'s `createApplication`, builds the router from `app.controllers`, and adds the HTTP-specific surface. `handle()` runs a request in-process, no socket — what `@blixis/testing` is built on. `listen()` binds a real `node:http` server. `close()` tears down both the socket (if listening) and the underlying `Application` (running `OnApplicationShutdown` hooks); **idempotent**, safe to call more than once. See [Running in Production](/guides/running-in-production/).

### `createHandler` / `buildRouter`

```ts
function createHandler(controllers: readonly Class[], application: Application, options?: HandlerOptions): (request: Request) => Promise<Response>;
function buildRouter(controllers: readonly Class[]): Router<RouteEntry>;

interface HandlerOptions {
  bodyLimit?: number; // bytes, default 1 MiB
}
```

The lower-level pieces `createHttpApplication` composes — `createHandler` builds the actual request-handling function from a resolved application's controllers; `buildRouter` alone builds just the route table (used internally, exposed for introspection). Throws `NotAControllerError` (naming the class) if a listed controller has no `@Controller()`.

## Controller decorators

```ts
function Controller(prefix?: string): ClassDecorator;
function getControllerPrefix(target: object): string | undefined;

function Get(path?: string): MethodDecorator;
function Post(path?: string): MethodDecorator;
function Put(path?: string): MethodDecorator;
function Patch(path?: string): MethodDecorator;
function Delete(path?: string): MethodDecorator;
function getRoutes(target: object): RouteDefinition[];

interface RouteDefinition {
  method: HttpMethod;
  path: string;
  propertyKey: string | symbol;
}

function HttpCode(code: number): MethodDecorator;
function getHttpCode(target: object, propertyKey: string | symbol): number | undefined;
```

`prefix`/`path` default to `""`; leading/trailing slashes are normalized away. `HttpCode` overrides the default response status (`200`, or `204` for an `undefined` return) for one method.

## Param decorators

```ts
function Body(schema?: ZodType): ParameterDecorator;
function Query(schema?: ZodType): ParameterDecorator;
function Param(name: string, schema?: ZodType): ParameterDecorator;
function Headers(name?: string): ParameterDecorator;
function Req(): ParameterDecorator;

function getParamSources(target: object, propertyKey: string | symbol): Map<number, ParamSource>;

type ParamSource =
  | { kind: "body"; schema?: ZodType }
  | { kind: "query"; schema?: ZodType }
  | { kind: "param"; name: string; schema?: ZodType }
  | { kind: "headers"; name?: string }
  | { kind: "req" };
```

Every schema is optional; without one you get the raw value (parsed JSON body, parsed query object, raw route-param string, header value/object). See [Request Validation](/concepts/request-validation/).

### Runtime resolution

```ts
function resolveHandlerArgs(sources: ReadonlyMap<number, ParamSource>, context: ParamResolutionContext): Promise<unknown[]>;

interface ParamResolutionContext {
  request: Request;
  routeParams: Readonly<Record<string, string>>;
  getBody: () => Promise<unknown>; // memoized per-request by the caller; rejects with an HttpException on 400/413/415
}
```

The function that actually turns a request + matched route into a controller method's argument list — used internally by `createHandler`, exposed for building your own request-handling pipeline on the same param decorators.

## Guards

```ts
interface CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}

interface ExecutionContext {
  request: Request;
  params: Readonly<Record<string, string>>;
}

function UseGuards(...guards: Class<CanActivate>[]): ClassDecorator & MethodDecorator;
function getClassGuards(target: object): Class<CanActivate>[];
function getMethodGuards(target: object, propertyKey: string | symbol): Class<CanActivate>[];
```

`UseGuards` works at the class position (every route) or the method position (one route); class-level guards run first. Guard classes must be registered providers — see [Guards & Authorization](/concepts/guards-and-authorization/#guard-classes-must-be-registered-providers).

## Router

```ts
class Router<T> {
  add(method: HttpMethod, path: string, handler: T): void;
  match(method: HttpMethod, path: string): RouteLookupResult<T>;
}

type RouteLookupResult<T> = RouteFound<T> | RouteNotFound | RouteMethodNotAllowed;

interface RouteFound<T> { kind: "found"; handler: T; params: Record<string, string> }
interface RouteNotFound { kind: "not-found" }
interface RouteMethodNotAllowed { kind: "method-not-allowed"; allowed: HttpMethod[] }
```

The trie router itself, generic over an opaque handler type — `@blixis/http` plugs in its own route-entry type internally; you could build a different framework on top of just this. See [Routing & Controllers](/concepts/routing-controllers/#how-a-request-is-matched) for the static/param/wildcard precedence rules.

## Exceptions

```ts
class HttpException extends Error {
  constructor(status: number, detail: string, extra?: Record<string, unknown>);
  readonly status: number;
  readonly detail: string;
  readonly extra?: Record<string, unknown>;
}

class BadRequestException extends HttpException {}          // 400, "Bad Request"
class UnauthorizedException extends HttpException {}         // 401, "Unauthorized"
class ForbiddenException extends HttpException {}             // 403, "Forbidden"
class NotFoundException extends HttpException {}               // 404, "Not Found"
class ConflictException extends HttpException {}               // 409, "Conflict"
class PayloadTooLargeException extends HttpException {}        // 413, "Payload Too Large"
class UnsupportedMediaTypeException extends HttpException {}   // 415, "Unsupported Media Type"
```

Every named subclass's `detail` (and, for `BadRequestException` only, `extra`) is overridable via its constructor argument. See [Error Handling](/concepts/error-handling/) for the full response shape and which of these fire automatically.

## Node adapter

```ts
function toWebRequest(req: IncomingMessage, baseUrl: string): Request;
function sendWebResponse(response: Response, res: ServerResponse): Promise<void>;
```

The two functions bridging Node's `node:http` types to the Web-standard `Request`/`Response` the rest of the framework is built on — what `HttpApplication.listen()` uses internally. `toWebRequest` correctly gives a bodyless request (a `GET`, or a `POST` with no declared body) a `null` body rather than an open empty stream, and wires the returned `Request`'s `signal` to the connection's `"aborted"` event.

## Types

```ts
const HTTP_METHODS: readonly ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
type HttpMethod = (typeof HTTP_METHODS)[number];
```
