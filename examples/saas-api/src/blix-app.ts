import { createAppModule } from "./app.module.js";

/**
 * What `blix run` boots (see `blix.config.ts`): the module graph for the current environment. A separate file, because
 * building it validates the environment, and importing `app.module.ts` in a test must not.
 */
export const AppModule = createAppModule(process.env);
