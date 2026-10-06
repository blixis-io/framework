---
"@blixis-io/http": patch
---

An `error` event on the Node HTTP server after it started listening no longer takes the process down. Without a listener Node rethrows it as an uncaught exception (running out of file descriptors is the usual cause), ending the process with every request in flight. `listen()` now keeps a listener for the life of the server and reports the error to `onError` with the new `phase: "server"`, or to `console.error` without it; the process keeps serving what it can. An error before the server started (the port is taken) still rejects `listen()` as before.
