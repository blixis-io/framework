---
"@blixis-io/http": patch
---

Write responses to the socket with a plain loop over the body's reader instead of `pipeline(Readable.fromWeb(body), res)`, and compute the listening address once instead of on every request. `pipeline` created an `AbortController` and a `DOMException` with a stack trace on every response; on the benchmark's `ping` route the server's CPU per request drops from 58.7 to 35.1 µs (bare `node:http` is 17.9). Behaviour is unchanged: backpressure, cancelling the body's source when the client disconnects, and destroying the response when the body fails are kept and are now covered by tests over a real socket.
