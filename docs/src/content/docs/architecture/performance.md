---
title: Performance
description: What one request costs in the framework, measured over real sockets with the environment recorded, how to run it yourself, and how not to misread the numbers.
sidebar:
  order: 4
---

A claim about speed needs the machine and the method next to it, so this page has both. The benchmark is `examples/benchmarks`: each workload is a real server on a real socket, driven by [autocannon](https://github.com/mcollina/autocannon) with 64 concurrent connections, with a 3-second warm-up that is not reported. It is a tool for **comparing scenarios** and **catching a regression on your own machine**, not a promise about yours.

## Run it

```bash
pnpm install && pnpm run build
pnpm --filter benchmarks bench                                  # all workloads, 10 s each, 5 cold starts each
pnpm --filter benchmarks bench -- --only ping,authenticated --duration 20 --connections 128
```

It prints its own environment block with the results, and exits non-zero if any request failed, since a benchmark that is measuring error pages gives a confident wrong number. A test checks that every workload really does what its description says (that the authenticated route refuses a missing token, that the middleware stack is on the response).

## What was measured

Apple M1 Pro (10 logical cores, 16 GB), macOS, Node 24.21, 2026-10-07, load generator on the same machine, 64 connections, 10 s after a 3 s warm-up. Cold start is the median of three spawns, from process start. One run per row.

| workload | req/s | server CPU µs per request | p50 ms | p99 ms | cold start to listening | RSS after the run |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `node-http`: bare `node:http`, one JSON response | 55 388 | 17.9 | 1 | 2 | 99 ms | 99 MB |
| `ping`: a controller route returning a small object | 29 283 | 35.1 | 2 | 4 | 103 ms | 483 MB |
| `middleware`: the route behind CORS, security headers and a rate limiter (in-memory store) | 22 783 | 45.5 | 2 | 5 | 101 ms | 333 MB |
| `validated`: POST a JSON body, validated with Zod both ways (`@Body` and `@Returns`) | 21 641 | 48.2 | 2 | 5 | 104 ms | 319 MB |
| `authenticated`: behind `protectAllRoutes` with a valid HS256 bearer token | 17 211 | 67.9 | 3 | 7 | 104 ms | 250 MB |

No request failed in any of them. **"Server CPU µs per request" is the server process's own CPU time (`process.cpuUsage()` before and after the run) divided by the requests it answered.** It is the column to compare, because throughput is not the server's alone: the load generator is one thread on the same machine, and it was the slower side in these runs (a profile of `ping` showed the server idle about 40% of the time). An earlier version of this page reported "µs per request" as the inverse of throughput, which understated the server's cost whenever the load generator was the limit.

## What the numbers say, and what they do not

- **The framework costs about 17 µs of CPU per request on top of bare Node on this machine**: the `ping` route is 35.1 µs where `node:http` alone is 17.9. That is routing, building a Web `Request`, the handler pipeline, and writing a `Response` back. A database query or an outbound HTTP call is usually hundreds of times that, which is why this matters less than it looks; it matters for cheap routes at high volume.
- **Each piece you add costs about what you would guess**: the baseline production stack (CORS, security headers, a rate-limit count) is about 10 µs, parsing a JSON body and validating it and the response with Zod about 13 µs, and **verifying a JWT and validating its claims about 33 µs on every request**, the largest single piece here. If that matters for a hot route, a short-lived in-process cache of verified tokens is the lever, and it is yours to build: the framework does not cache verification, because a cache is a revocation delay.
- **Cold start to listening is about 100 ms, the same for the bare server and the framework**, so for apps this small the cost is Node starting and loading modules, not the framework's container. An app with many providers and a database pool takes longer; this does not measure that.
- **The tail is short** (p99 under 10 ms at 64 connections), with an occasional slow outlier (a `max` of 79 ms in the `ping` run, a garbage collection or the scheduler; one run, not investigated).
- **Memory is not a leak measure.** RSS after a run with a load generator on the same machine includes garbage the collector has not yet returned, and is several times the bare server's; it also grows with throughput, since a faster server produces garbage faster. A separate check ran `ping` for four 10 s phases (1.27 million requests) and forced a garbage collection after each: heap in use stayed at 12 to 15 MB, there was one active handle, and RSS settled at about 360 MB without growing (360, 365, 369, 369).

## What a profile found (2026-10-07)

The `ping` route cost 3.4 times the bare server's CPU per request, and this page used to say why was not known. A CPU profile of the server answered it: the way responses were written to the socket accounted for most of the difference. (The two changes below were measured together, not one at a time; by the profile the second is about 2%.)

| server CPU µs per request | before | after | change |
| --- | ---: | ---: | ---: |
| `node-http` (control: no framework, not changed) | 17.9 | 17.9 | none |
| `ping` | 58.7 | 35.1 | 40% less |
| `middleware` | 68.6 | 45.5 | 34% less |
| `validated` | 100.1 | 48.2 | 52% less |
| `authenticated` | 92.1 | 67.9 | 26% less |

- **The cause:** the Node adapter wrote every response with `pipeline(Readable.fromWeb(body), res)`. `pipeline` creates an `AbortController` per call and aborts it when it finishes, which builds a `DOMException` with a captured stack trace **on every response**; `Readable.fromWeb` also builds a second stream around the Web one. Together that was the largest item in the profile that was not Node's own work. It is now a plain loop over the body's reader that does the same three things `pipeline` did for us: it waits for `drain` when the socket is full, it cancels the body's source when the client disconnects (a database cursor stops being read), and it destroys the response and rethrows when the body fails. Those behaviours had no tests before; they have now (`send-response.test.ts`, over a real socket), and the same tests were run against the old implementation to confirm they pass on both, so the behaviour is the same, only cheaper.
- **A smaller one:** the server's listening address was looked up and formatted on every request, about 2% of the profile; it is now computed once.
- **Ruled out by measuring:** an extra socket write per response (counted: one `writev` per request, the same as bare Node), and a memory leak in the new write path (the four-phase run above).
- **What is left, and is not the framework's to remove:** the Web `Response` costs about 2.2 to 2.7 µs to construct with a body (0.25 µs without one: the difference is the stream the runtime builds around the body), and the Web `Request` about 2.1 µs with an abort signal (1.05 µs without). With `requestTimeout` on (the default), the handler also builds a second `Request` to carry the deadline, about 5% of the profile, which could be avoided by handing the deadline to the adapter; that was not done, because it changes how `handle()` is called from outside.

How this was measured, so it can be repeated: `node --cpu-prof` on a server running the `ping` workload under autocannon, summarised by self and inclusive time per function; a micro-benchmark of the `Request` and `Response` constructors in isolation; and `pnpm --filter benchmarks bench`, before and after, on the same machine in the same session, with the bare-`node:http` workload as a control that must not move. It is one machine, one runtime version, and only `ping` was profiled; the other workloads were measured, not profiled.

What is **not** measured: a database, network latency, a separate load-generator machine (so absolute throughput is lower than a dedicated client would show), many routes (the router lookup is covered by [property tests](https://github.com/blixis-io/framework/blob/main/packages/http/src/router.property.test.ts), and `review.md` measured 0.3 µs per match with 200 routes in-process), TLS, HTTP/2, large bodies, a streamed response under the benchmark's load (it is tested for correctness over a real socket, not timed), or any other runtime than Node 24.

## No budget in CI, on purpose

CI runners are shared machines with noisy neighbours, so a throughput threshold there would fail for reasons that have nothing to do with a change. Instead: run the benchmark before and after a change that could matter, on the same machine, and compare the rows. If a performance budget is ever added, it should compare against a baseline measured in the same job, not against a fixed number.
