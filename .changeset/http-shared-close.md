---
"@blixis-io/http": patch
---

`HttpApplication.close()` now returns one shared promise. Before, a second `close()` made while the first was still draining requests skipped the drain and ran the shutdown hooks straight away, so a database pool could be closed under requests that were still running (a signal handler plus a test's cleanup, which the docs say is safe, was enough). Every caller now waits for the same drain and teardown, the hooks run once, and a failing hook rejects every caller with the same error. `listen()` now rejects if the application is already listening or has been closed, instead of replacing the first server and losing the handle to it.
