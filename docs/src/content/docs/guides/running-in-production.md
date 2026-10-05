---
title: Running in Production
description: listen(), close(), and graceful shutdown on SIGTERM.
sidebar:
  order: 8
---

## The entry point

```ts title="src/main.ts"
import { createHttpApplication } from "@blixis-io/http";
import { AppModule } from "./app.module.js";

const port = Number(process.env["PORT"] ?? 3000);

const app = await createHttpApplication(AppModule);
await app.listen(port);

console.log(`Listening on http://localhost:${port}`);
```

`listen(port, hostname?)` binds a real `node:http` server and resolves once it's actually accepting connections, with `{ port }` reflecting the bound port (useful when you pass `0` to let the OS pick one, e.g. in tests). `hostname` defaults to `"0.0.0.0"` — all interfaces; pass `"127.0.0.1"` to bind localhost only.

Under the hood, every incoming `IncomingMessage` is converted to a Web-standard `Request` (including a real `AbortSignal` wired to the client connection — see below) and every returned `Response` is streamed back onto the socket. None of this is something you write; it's what `listen()` sets up.

## Graceful shutdown

```ts
process.on("SIGTERM", () => {
  void app.close("SIGTERM").then(() => process.exit(0));
});
```

`app.close(signal?)` closes the listening socket *and* runs every `OnApplicationShutdown` hook in the application (see [Lifecycle Hooks](/framework/concepts/lifecycle-hooks/)) — the string you pass through is handed to each hook as-is, so a database connection's shutdown hook can log or branch on which signal triggered it. `close()` is idempotent: calling it more than once (a signal handler *and* a test's cleanup both running it, say) is safe — the second call is a no-op, not a duplicate teardown.

## Malformed requests

On `listen()`, Node's HTTP parser rejects broken framing before a controller ever runs, and the server keeps serving other connections:

- request headers over Node's `maxHeaderSize` (16 KiB by default) → `431 Request Header Fields Too Large`
- a non-numeric, negative or duplicated `Content-Length`, or `Content-Length` together with `Transfer-Encoding` → `400 Bad Request`
- bytes past the declared `Content-Length` are parsed as the next request on the connection; if they aren't valid HTTP that is a `400` and the connection is closed

A body that never reaches its declared `Content-Length` keeps the request waiting until the client hangs up (answered with `400`, see [Body parsing rules](/framework/concepts/request-validation/#body-parsing-rules)) or until `requestTimeout` (`504`). A chunked body without a `Content-Length` is cut off with `413` as soon as it crosses `bodyLimit`, even while the client is still sending. A client that disconnects mid-body is not logged as a server error.

## Client disconnects propagate as a real `AbortSignal`

`close()` stops accepting new connections, drops idle keep-alive sockets, and lets in-flight requests finish. Anything still running after `shutdownTimeout` (default 10 seconds) has its socket destroyed, which aborts its `request.signal`. Pass `shutdownTimeout: Infinity` to wait indefinitely, or a smaller value to fit your orchestrator's kill grace period.

```ts
const app = await createHttpApplication(AppModule, { shutdownTimeout: 5_000 });
```

If a client closes the connection before a handler finishes, the `Request`'s `signal` fires `"abort"` — useful for cancelling expensive work early:

```ts
@Get("report")
async generateReport(@Req() req: Request) {
  const result = await computeReport({ signal: req.signal });
  return result;
}
```

## In-process, without a socket at all

`app.handle(request)` runs the exact same request-handling logic — routing, validation, guards, error mapping — against an in-memory `Request`, with no server, no port, no network stack. This is what `@blixis-io/testing` is built on (see [Testing](/framework/concepts/testing/)), and it's also a reasonable way to invoke the same application logic from a non-HTTP entry point (a CLI command, a queue worker) without spinning up a socket you don't need.

## The origin of `request.url`

`request.url` is a full URL, and its origin (`scheme://host[:port]`) comes from the address the server **listens on**, with the port it actually bound (so `listen(0)` reports the real port, not `0`). Client headers don't influence it by default, because a client can send any `Host` and any `X-Forwarded-*`. Two options let you opt in:

```ts
// Clients reach the server directly, by its public name:
const app = await createHttpApplication(AppModule, { trustHostHeader: true });

// The server sits behind a proxy or load balancer you control:
const app = await createHttpApplication(AppModule, { trustProxy: true });
```

| Option | `request.url` origin comes from |
| --- | --- |
| neither | the listen address |
| `trustHostHeader` | the `Host` header, over `http` |
| `trustProxy` | `X-Forwarded-Proto` and `X-Forwarded-Host` (first value of each), else `Host`; implies `trustHostHeader` |

Only a bare `host` or `host:port` is accepted (letters, digits, `-`, `_`, dots, or a bracketed IPv6 literal), and only `http` or `https` for the scheme. Anything else, such as `evil.com/path`, `user@evil.com` or a `javascript:` scheme, is ignored and the listen address is used instead, so a hostile header can't smuggle a path or credentials into the URL. Turn on `trustProxy` only when the proxy **overwrites** those headers; otherwise any client can claim any origin. Even with an option on, build absolute links in emails and redirects from a configured public URL, not from `request.url`. A server bound to an IPv6 address (`listen(3000, "::1")`) is written with brackets (`http://[::1]:3000`), which `new URL` requires.

Under `createFetchHandler` the platform supplies the `Request` and its URL; these options don't apply.

## What isn't handled for you yet

There's no built-in request logging, rate limiting, CORS, or compression middleware — the framework's HTTP layer is deliberately just routing + validation + guards + error mapping (see [Introduction](/framework/start-here/introduction/)). For now, that means wrapping `app.handle` yourself (a function that calls `app.handle(request)` and does something before/after) or reaching for `node:http`-level middleware ahead of the `createServer` callback if you need it. A first-class middleware/interceptor layer is on the framework's roadmap but doesn't exist yet.

## On a platform that calls `fetch` (Vercel, Netlify, Cloudflare Workers)

`listen()` is for a long-lived Node process. On a serverless or edge platform the platform owns the socket and calls your code once per request, so export a fetch handler instead:

```ts title="api/index.js"
import { createFetchHandler } from "@blixis-io/http";
import { AppModule } from "../dist/app.module.js";

export default createFetchHandler(AppModule);
```

The object has `fetch(request)` (what Vercel and Workers look for) and `close()`. The application boots on the first request, once; requests that arrive while it is booting share that boot, and later requests reuse it. If boot fails, that request gets a generic `500` (the real error is logged, never sent to the client) and the next request tries again instead of caching the failure.

`listen()`, `shutdownTimeout` and the `SIGTERM` handler don't apply here. Options such as `requestTimeout`, `bodyLimit` and `responseValidation` do: `createFetchHandler(AppModule, { requestTimeout: 8000 })`.

Run it from compiled JavaScript (`tsc` or Rolldown output). The providers' own TypeScript bundlers use esbuild, which drops the decorator metadata the DI container needs. See [Compatibility](/framework/architecture/compatibility/#deployment-targets) for what has been run where.
