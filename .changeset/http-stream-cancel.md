---
"@blixis-io/http": patch
---

A client that disconnects while a streamed response is being written now cancels the response's source stream. Before, the stream was left running, so its producer (a DB cursor, a file handle) was never released. `sendWebResponse` now uses `stream.pipeline` and treats an early disconnect as normal rather than an error.
