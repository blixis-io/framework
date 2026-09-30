import { defineConfigModule } from "@blixis-io/config";
import { z } from "zod";

export const AppConfigSchema = z.object({
  PORT: z.coerce.number().default(3000),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const { CONFIG, ConfigModule } = defineConfigModule(AppConfigSchema);
