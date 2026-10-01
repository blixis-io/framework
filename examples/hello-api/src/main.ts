import { createHttpApplication } from "@blixis-io/http";
import { LOGGER } from "@blixis-io/logging";
import { serveOpenApi } from "@blixis-io/openapi";
import { AppModule } from "./app.module.js";
import { CONFIG } from "./config.js";

const app = await createHttpApplication(AppModule);
serveOpenApi(app, "/openapi.json", {
  title: "hello-api",
  version: "1.0.0",
  description: "The framework's own reference example — a Postgres-backed posts CRUD API.",
});

const { PORT } = app.get(CONFIG);
await app.listen(PORT);

const log = app.get(LOGGER);
log.info("hello-api listening", { port: PORT });

process.on("SIGTERM", () => {
  log.info("received SIGTERM, shutting down");
  void app.close("SIGTERM").then(() => process.exit(0));
});
