---
"@blixis-io/cli": patch
---

Fix a deadlock when a plugin or `blix.config.ts` imports from `@blixis-io/cli`: the `blix` bin and the library entry were the same file, so importing the library while the bin was mid-`await runCli()` waited on itself forever (`Detected unsettled top-level await`, exit 13). The bin is now `dist/bin.js` and the library `dist/index.js`, which has no top-level side effects.
