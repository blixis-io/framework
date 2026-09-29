import { createHttpApplication } from "@blixis/http";
import { AppModule } from "./app.module.js";

const port = Number(process.env["PORT"] ?? 3000);

const app = await createHttpApplication(AppModule);
await app.listen(port);

console.log(`hello-api listening on http://localhost:${port}`);

process.on("SIGTERM", () => {
  void app.close("SIGTERM").then(() => process.exit(0));
});
