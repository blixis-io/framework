---
"@blixis-io/cli": patch
"@blixis-io/deploy": patch
---

Names typed on the command line no longer match properties inherited from `Object.prototype`, and the generator refuses names it can't turn into valid TypeScript.

**Prototype keys.** The plugin registry, the generator aliases, the CI providers and the deploy targets were looked up as plain object properties, so `constructor`, `toString`, `valueOf`, `hasOwnProperty` and `__proto__` found something that isn't there. Fixed against the built CLI: `blix add constructor` ran `npm install -D undefined` and reported `Added undefined`; `blix constructor` said it "needs undefined, which isn't installed"; `blix g constructor users` crashed with `Unreachable: unknown generator type function Object() { [native code] }`; `blix deploy ci constructor` and `blix deploy constructor` produced nonsense providers and targets. They now say the command, plugin, type, provider or target is unknown. A deploy target that really is called `constructor` still works.

**Generator names.** `blix g c 123` wrote `src/123/123.controller.ts` containing `export class 123Controller`, which is not valid TypeScript; `blix g c café` silently wrote `src/caf/caf.controller.ts`. Both are now refused with a message that says what to change (start with a letter; use ASCII letters and digits), and nothing is written, including on `--dry-run`.
