---
"@blixis-io/http": patch
---

`requestTimeout` now covers the whole request. Before, only interceptors and the handler were raced against the deadline, so a guard that never settled meant no `504` at all, and handlers registered with `mount()` had no deadline. Routing, guards, argument parsing, interceptors, the handler and mounted handlers now share one budget, and the `request` a guard receives carries the deadline in its `signal`. A late guard also no longer starts more work: once the deadline has passed (or the client has left), the next guard and the controller method are not called, where before a guard settling after the `504` still let the controller run. This only applies when `requestTimeout` is set. Work already running is still not cancelled; it has to watch `request.signal`.
