---
"@blixis-io/logging": minor
---

Three logging fixes, one of them a new option.

**Errors are no longer lost.** The console transport wrote the context with `JSON.stringify`, which turns an `Error` into `{}`: `log.error("failed", { err })` printed `{"err":{}}` (or just `{"code":"ECONNREFUSED"}` when the error carried a property), with no message and no stack. It now writes the error's name, message, stack, cause chain and own properties. If you parsed the old output, note that an error in the context now appears as an object with those fields.

**A log line is never dropped for what it contains.** A circular object or a `BigInt` made `JSON.stringify` throw; the logger caught it and wrote only `[@blixis-io/logging] a transport failed`, losing the entry. They are now written (`"[Circular]"`, the BigInt as text), as are functions, symbols, `Map` and `Set`, and a getter that throws. New exports `safeStringify` and `toJsonSafe` let your own transports do the same.

**New `redact` option** on `createLogger` and `LoggerModule.forRoot`: a list of key names whose values never reach a transport (`"[REDACTED]"`, at any depth, by whole name, ignoring case). `COMMON_SECRET_KEYS` is a starting list. Opt-in: nothing changes unless you pass it. With it set, a transport receives each context as plain data, so an attached `Error` arrives as an object rather than an `Error` instance. It covers the context only, not the message string.

**Disabled levels cost almost nothing.** The logger merged the bound and per-call contexts before checking whether anyone would receive the entry, so a `debug` call below the level still copied them: about 98 ns per call with a small context, 9 ns now (measured on the built package, 2 million calls; indicative, not a benchmark suite).
