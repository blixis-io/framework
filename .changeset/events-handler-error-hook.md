---
"@blixis-io/events": minor
---

A failing event listener can now go to your logger. `EventsModule.forRoot({ onHandlerError })` is called for every handler that throws or rejects, with the event `type`, the `error` and the `payload` the handler was given (which may hold personal data, so log only what you need); `emit()` still resolves and sibling handlers still run. Without it the failure is written with `console.error`, as before, and a hook that itself throws is caught and both failures are written. Exports `EventHandlerFailure`.
