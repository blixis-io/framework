---
"@blixis-io/core": minor
---

New `onRollbackError` option on `createApplication`: called for each `onApplicationShutdown` hook that fails while a failed boot is being rolled back. The boot's own error is still what `createApplication` rejects with. Without the option the failure is written with `console.error`, as before; a hook that throws is caught and both failures are written.
