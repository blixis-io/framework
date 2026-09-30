import { createHttpApplication } from "@blixis-io/http";
import { LOGGER } from "@blixis-io/logging";
import { AppModule } from "./app.module.js";
import { CONFIG } from "./config.js";
import { AppRef } from "./docs/app-ref.js";

const app = await createHttpApplication(AppModule);
app.get(AppRef).current = app;

const { PORT } = app.get(CONFIG);
await app.listen(PORT);

const log = app.get(LOGGER);
log.info("hello-api listening", { port: PORT });

process.on("SIGTERM", () => {
  log.info("received SIGTERM, shutting down");
  void app.close("SIGTERM").then(() => process.exit(0));
});
