import { createHttpApplication } from "@blixis/http";
import { LOGGER } from "@blixis/logging";
import { AppModule } from "./app.module.js";
import { CONFIG } from "./config.js";

const app = await createHttpApplication(AppModule);

const { PORT } = app.get(CONFIG);
await app.listen(PORT);

const log = app.get(LOGGER);
log.info("hello-api listening", { port: PORT });

process.on("SIGTERM", () => {
  log.info("received SIGTERM, shutting down");
  void app.close("SIGTERM").then(() => process.exit(0));
});
