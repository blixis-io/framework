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

Apple M1 Pro (10 logical cores, 16 GB), macOS, Node 24.21, 2026-10-06, load generator on the same machine, 64 connections, 10 s after a 3 s warm-up. Cold start is the median of five spawns, from process start.

| workload | req/s | µs per request | p50 ms | p99 ms | cold start to listening | RSS after the run |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `node-http`: bare `node:http`, one JSON response | 69 951 | 14 | 0 | 2 | 89 ms | 99 MB |
| `ping`: a controller route returning a small object | 19 077 | 52 | 3 | 6 | 89 ms | 303 MB |
| `middleware`: the route behind CORS, security headers and a rate limiter (in-memory store) | 16 565 | 60 | 3 | 7 | 89 ms | 270 MB |
| `validated`: POST a JSON body, validated with Zod both ways (`@Body` and `@Returns`) | 14 621 | 68 | 3 | 8 | 91 ms | 308 MB |
| `authenticated`: behind `protectAllRoutes` with a valid HS256 bearer token | 13 086 | 76 | 4 | 8 | 91 ms | 265 MB |

No request failed in any of them. "µs per request" is just the inverse of throughput (one core's worth of server time per request at saturation), there to make differences easy to read.

## What the numbers say, and what they do not

- **The framework costs about 38 µs per request on top of bare Node on this machine**: the `ping` route is 52 µs where `node:http` alone is 14. That is routing, building a Web `Request`, the handler pipeline, and writing a `Response` back. A database query or an outbound HTTP call is usually hundreds of times that, which is why this matters less than it looks; it matters for cheap routes at high volume.
- **Each piece you add costs about what you would guess, and no more**: the baseline production stack (CORS, security headers, a rate-limit count) is about 8 µs, validating a body and a response with Zod about 16 µs, and verifying a JWT and validating its claims about 24 µs on every request.
- **Cold start to listening is about 90 ms, the same for the bare server and the framework**, so for apps this small the cost is Node starting and loading modules, not the framework's container. An app with many providers and a database pool takes longer; this does not measure that.
- **The tail is short** (p99 under 10 ms at 64 connections), with an occasional slow outlier (a `max` of 154 ms in the `validated` run, a garbage collection or the scheduler; one run, not investigated).
- **Memory is not a leak measure.** RSS after a run with a load generator on the same machine includes garbage the collector has not yet returned, and is 3x the bare server's. It says nothing about steady-state memory.

What is **not** measured: a database, network latency, a separate load-generator machine (so absolute throughput is lower than a dedicated client would show), many routes (the router lookup is covered by [property tests](https://github.com/blixis-io/framework/blob/main/packages/http/src/router.property.test.ts), and `review.md` measured 0.3 µs per match with 200 routes in-process), TLS, HTTP/2, large bodies, streaming responses, or any other runtime than Node 24. **Why the `ping` route is 3.7x the bare server was not profiled**; the conversion between Node's request and response objects and the Web ones is a suspect, but that is a guess, and a profile is the next step if this ever needs to be faster.

## No budget in CI, on purpose

CI runners are shared machines with noisy neighbours, so a throughput threshold there would fail for reasons that have nothing to do with a change. Instead: run the benchmark before and after a change that could matter, on the same machine, and compare the rows. If a performance budget is ever added, it should compare against a baseline measured in the same job, not against a fixed number.
