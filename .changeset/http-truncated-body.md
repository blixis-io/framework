---
"@blixis-io/http": patch
---

Treat a request body cut off by the client (a disconnect or half-close before the declared length arrived) as `400 Bad Request` instead of an unexpected `500`, and skip writing a response to a client that is already gone. Neither case logs a server error any more; previously each such disconnect logged two stack traces.
