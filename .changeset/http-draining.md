---
"@blixis-io/http": minor
---

`HttpApplication` has a `draining` flag and a `startDraining()` method. `draining` is `true` from the moment `close()` is called (so a request still being served can see it) or `startDraining()` has been called; `startDraining()` marks the application as draining without closing anything, for the shutdown sequence a load balancer needs: on the signal, start draining so readiness reports "not ready", wait for the balancer's health check to notice, then `close()`. Closing first refuses connections before the balancer knows to stop using the instance. Nothing else changes. `@blixis-io/health` builds the readiness endpoint on it.
