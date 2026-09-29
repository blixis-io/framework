import { createHttpApplication } from "@blixis/http";
import { LOGGER } from "@blixis/logging";
import { AppModule } from "./app.module.js";

const port = Number(process.env["PORT"] ?? 3000);

const app = await createHttpApplication(AppModule);
await app.listen(port);

const log = app.get(LOGGER);
log.info("hello-api listening", { port });

process.on("SIGTERM", () => {
  log.info("received SIGTERM, shutting down");
  void app.close("SIGTERM").then(() => process.exit(0));
});
