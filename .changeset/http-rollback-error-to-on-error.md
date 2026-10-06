---
"@blixis-io/http": patch
---

A shutdown hook that fails while a failed boot is rolled back (inside `@blixis-io/core`, before the HTTP handler is even built) now reaches `onError` with `phase: "shutdown"`, like the one from a failed handler build already did. Before it was written with `console.error` whatever `onError` said. Without `onError` the output is unchanged.
