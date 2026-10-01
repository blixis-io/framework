---
"create-blixis": patch
---

The scaffolded app now has a `dev` script (`tsc --watch` plus `node --watch` on the compiled output, via `concurrently`), and the printed next step is `dev` instead of `build && start`.
