import { createApp } from "./app.js";
import { AppConfigSchema } from "./config.js";

const { PORT } = AppConfigSchema.parse(process.env);
const app = await createApp();
await app.listen(PORT);
console.log(`saas-api listening on ${PORT}`);

// Shutdown, in the order a load balancer needs: say "not ready" first, give it time to notice, then stop.
process.on("SIGTERM", () => {
  app.startDraining();
  console.log("SIGTERM: draining");
  setTimeout(() => {
    void app.close("SIGTERM").then(() => process.exit(0));
  }, 5_000);
});
