import { createBuildConfig } from "../../rolldown.shared.js";

// Two entries on purpose: `bin` runs the CLI at the top level, `index` is the importable library.
// A plugin or a blix.config.ts that imports "@blixis-io/cli" must never load a module that is
// itself mid-way through `await runCli(...)`, or the two wait on each other forever.
export default createBuildConfig({ index: "src/index.ts", bin: "src/bin.ts" });
