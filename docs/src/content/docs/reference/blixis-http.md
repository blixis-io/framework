---
title: "@blixis-io/http"
description: Full API reference for the HTTP layer — routing, controllers, validation, guards, errors.
sidebar:
  order: 3
---

Routing, controller/param/guard decorators, Zod-backed validation, RFC 9457 errors, and the Node adapter. See [Routing & Controllers](/framework/concepts/routing-controllers/), [Request Validation](/framework/concepts/request-validation/), [Guards & Authorization](/framework/concepts/guards-and-authorization/), and [Error Handling](/framework/concepts/error-handling/) for the concepts.

## Application

### `createHttpApplication` / `HttpApplication`

```ts
function createHttpApplication(rootModule: ModuleRef, options?: HttpApplicationOptions): Promise<HttpApplication>;

type HttpApplicationOptions = HandlerOptions & CreateApplicationOptions & ShutdownOptions & OriginOptions & MiddlewareOptions; // bodyLimit + requestTimeout + overrides + shutdownTimeout + trustHostHeader/trustProxy + middleware

interface MiddlewareOptions {
  middleware?: readonly Middleware[]; // outermost first; see Middleware
}

type Middleware = (request: Request, next: NextFunction) => Response | Promise<Response>;
type NextFunction = (request?: Request) => Promise<Response>; // at most once; pass a Request to hand on a changed one

interface OriginOptions {
  trustHostHeader?: boolean; // request.url's origin from the Host header; default false (the listen address)
  trustProxy?: boolean; // ... from X-Forwarded-Proto/-Host, else Host; implies trustHostHeader; default false
}

interface ShutdownOptions {
  shutdownTimeout?: number; // ms close() waits for in-flight requests, default 10000; Infinity = wait forever
}

function createFetchHandler(rootModule: ModuleRef, options?: HttpApplicationOptions): FetchHandler;

interface FetchHandler {
  fetch(request: Request): Promise<Response>;
  close(signal?: string): Promise<void>;
}

class HttpApplication {
  get<T>(token: Token<T>): T;
  get controllers(): readonly Class[];
  handle(request: Request): Promise<Response>;
  mount(method: "GET" | "POST", path: string, handler: (request: Request) => Response | Promise<Response>): void;
  listen(port: number, hostname?: string): Promise<ListenHandle>; // hostname defaults to "0.0.0.0"
  close(signal?: string): Promise<void>;
}

interface ListenHandle {
  port: number; // the actually-bound port, useful when you pass 0
}
```

Wraps `@blixis-io/core`'s `createApplication`, builds the router from `app.controllers`, and adds the HTTP-specific surface. `handle()` runs a request in-process, no socket — what `@blixis-io/testing` is built on. `listen()` binds a real `node:http` server; it can be called once, and rejects if the application is already listening or has been closed. `mount()` serves an exact path with a plain handler ahead of the router — public (bypasses guards and interceptors, but not `requestTimeout`: a mounted handler gets the same deadline, with `request.signal` aborting at it), throws on a duplicate method+path; it's what `serveOpenApi` uses. `close()` tears down both the socket (if listening) and the underlying `Application` (running `OnApplicationShutdown` hooks); **idempotent**: every call returns the same promise, so a second caller waits for the same drain and teardown instead of closing the application under running requests, and the hooks run once (a failing hook rejects every caller; the first call's `signal` is the one hooks see). See [Running in Production](/framework/guides/running-in-production/). `controllers` exposes every controller class in the app's module graph — what [`@blixis-io/openapi`](/framework/reference/blixis-openapi/) walks to build a document that stays in sync with the real running app, without a separately-maintained route list.

### `createHandler` / `buildRouter`

```ts
function createHandler(controllers: readonly Class[], application: Application, options?: HandlerOptions): (request: Request) => Promise<Response>;
function buildRouter(controllers: readonly Class[]): Router<RouteEntry>;

interface HandlerOptions {
  bodyLimit?: number; // bytes, default 1 MiB
  requestTimeout?: number; // ms, default off — see below
  responseValidation?: "always" | "never"; // default "always" — see Response Validation
}
```

`requestTimeout` answers `504 Gateway Timeout` (problem+json) once a request has run that long. The budget covers routing, guards, argument parsing, interceptors, the handler and handlers registered with `mount()`. It does **not** kill running work (though a guard that settles after the deadline will not start the next guard or the controller): `request.signal` (via `@Req()`) aborts at the deadline, and the handler must pass it to cancellable work (`fetch`, DB queries) to actually stop. The same `request.signal` also aborts when the client disconnects; with `requestTimeout` set, that case answers `499`. `GatewayTimeoutException` is exported for custom use.

The lower-level pieces `createHttpApplication` composes — `createHandler` builds the actual request-handling function from a resolved application's controllers; `buildRouter` alone builds just the route table (used internally, exposed for introspection). Throws `NotAControllerError` (naming the class) if a listed controller has no `@Controller()`, or `DuplicateRouteError` if two routes register the same method+path — a route table is built once at startup, so this fails fast at boot rather than silently letting the second registration replace the first.

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

## Returns (response validation)

```ts
function Returns(schema: ZodType, options?: ReturnsOptions): MethodDecorator;
interface ReturnsOptions {
  validate?: boolean; // per-route override of responseValidation, in either direction
}
function getReturnsValidate(target: object, propertyKey: string | symbol): boolean | undefined;
function getReturnsSchema(target: object, propertyKey: string | symbol): ZodType | undefined;

class ResponseValidationError extends Error {
  readonly issues: readonly { path: PropertyKey[]; message: string }[];
}

function validateResponse(schema: ZodType | undefined, value: unknown): Promise<unknown>;
```

Validates a handler's return value against `schema` before serialization; the parsed/coerced value is what's actually sent. A mismatch throws `ResponseValidationError` (not an `HttpException`), which surfaces to the client as a generic `500` — never the schema issues themselves, since a response mismatch is a server bug, not client input. Skipped entirely for a route returning `undefined` (204) or a raw `Response`. See [Response Validation](/framework/concepts/response-validation/).

## API documentation metadata

```ts
interface ApiOperationOptions {
  summary?: string;
  description?: string;
  operationId?: string; // defaults to `${ControllerName}_${methodName}` when omitted
}
function ApiOperation(options: ApiOperationOptions): MethodDecorator;
function getApiOperation(target: object, propertyKey: string | symbol): ApiOperationOptions | undefined;

function ApiTags(...tags: string[]): ClassDecorator & MethodDecorator;
function getClassApiTags(target: object): string[];
function getMethodApiTags(target: object, propertyKey: string | symbol): string[];
```

Both entirely optional — [`@blixis-io/openapi`](/framework/reference/blixis-openapi/) derives a working document (with a valid, unique `operationId`) even without them. `ApiTags` works like `UseGuards`/`UseInterceptors` — class position or method position — except class-level and method-level tags **concatenate** rather than one replacing the other. See [API Documentation](/framework/concepts/api-documentation/).

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

Every schema is optional; without one you get the raw value (parsed JSON body, parsed query object, raw route-param string, header value/object). See [Request Validation](/framework/concepts/request-validation/).

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
  controller: Class; // the controller whose route is being handled
  handler: string | symbol; // the method handling it
}

function UseGuards(...guards: Class<CanActivate>[]): ClassDecorator & MethodDecorator;
function GlobalGuard(): ClassDecorator; // the guard runs on every route, before the route's own guards
function isGlobalGuard(target: object): boolean;
function SetRouteMetadata(key: symbol, value: unknown): ClassDecorator & MethodDecorator;
function getRouteMetadata(key: symbol, context: Pick<ExecutionContext, "controller" | "handler">): unknown; // method value, else controller value
function getClassGuards(target: object): Class<CanActivate>[];
function getMethodGuards(target: object, propertyKey: string | symbol): Class<CanActivate>[];
```

`UseGuards` works at the class position (every route) or the method position (one route); class-level guards run first. Guard classes must be registered providers — see [Guards & Authorization](/framework/concepts/guards-and-authorization/#guard-classes-must-be-registered-providers).

## Interceptors

```ts
interface Interceptor {
  intercept(context: ExecutionContext, next: () => Promise<Response>): Response | Promise<Response>;
}

function UseInterceptors(...interceptors: Class<Interceptor>[]): ClassDecorator & MethodDecorator;
function getClassInterceptors(target: object): Class<Interceptor>[];
function getMethodInterceptors(target: object, propertyKey: string | symbol): Class<Interceptor>[];
```

Wraps param resolution + handler invocation in an onion chain, running after guards. `UseInterceptors` works at the class position (outermost) or the method position (innermost); an interceptor class must be a registered provider, same rule as guards. See [Interceptors](/framework/concepts/interceptors/).

## RequestContext

```ts
class RequestContext {
  get<T = unknown>(key: string): T | undefined;
  has(key: string): boolean;
  set(key: string, value: unknown): void; // throws RequestContextError outside a request
}

class RequestContextError extends Error {}

function runInRequestContext<T>(fn: () => T): T;
```

Injectable anywhere without registering it — `createHttpApplication` provides it globally, through the exported global `RequestContextModule`. Entry points that boot an app without the HTTP layer (`blix run` does) import that module to provide it too. `runInRequestContext` is what `createHandler` wraps around each request; you only call it yourself if you're building a request-handling pipeline outside `createHandler`. See [Request Context](/framework/concepts/request-context/).

## Router

```ts
class Router<T> {
  add(method: HttpMethod, path: string, handler: T): void;
  match(method: HttpMethod, path: string): RouteLookupResult<T>;
}

type RouteLookupResult<T> = RouteFound<T> | RouteNotFound | RouteMethodNotAllowed | RouteMalformedPath;

interface RouteFound<T> { kind: "found"; handler: T; params: Record<string, string> }
interface RouteNotFound { kind: "not-found" }
interface RouteMethodNotAllowed { kind: "method-not-allowed"; allowed: HttpMethod[] } // the methods of every route that matches the path
interface RouteMalformedPath { kind: "malformed-path" } // a segment has a broken % escape
```

The trie router itself, generic over an opaque handler type — `@blixis-io/http` plugs in its own route-entry type internally; you could build a different framework on top of just this. A route only matches the method it was registered with, so a request falls through to the next candidate (static, then param, then wildcard) instead of stopping at a sibling that has other methods only. See [Routing & Controllers](/framework/concepts/routing-controllers/#how-a-request-is-matched) for the precedence rules.

## Exceptions

```ts
class HttpException extends Error {
  constructor(status: number, detail: string, extra?: Record<string, unknown>, headers?: Readonly<Record<string, string>>);
  readonly status: number;
  readonly detail: string;
  readonly extra?: Record<string, unknown>; // merged into the problem+json body
  readonly headers?: Readonly<Record<string, string>>; // sent with the response
}

class BadRequestException extends HttpException {}          // 400, "Bad Request"
class UnauthorizedException extends HttpException {            // 401, "Unauthorized"
  constructor(detail?: string, challenge?: string);            // challenge is sent as WWW-Authenticate
}
class ForbiddenException extends HttpException {}             // 403, "Forbidden"
class NotFoundException extends HttpException {}               // 404, "Not Found"
class ConflictException extends HttpException {}               // 409, "Conflict"
class PayloadTooLargeException extends HttpException {}        // 413, "Payload Too Large"
class UnsupportedMediaTypeException extends HttpException {}   // 415, "Unsupported Media Type"
```

Every named subclass's `detail` (and, for `BadRequestException` only, `extra`) is overridable via its constructor argument. See [Error Handling](/framework/concepts/error-handling/) for the full response shape and which of these fire automatically.

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
