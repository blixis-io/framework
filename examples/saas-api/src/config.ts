import { defineConfigModule } from "@blixis-io/config";
import { z } from "zod";

export const AppConfigSchema = z.object({
  PORT: z.coerce.number().default(3000),
  /** No default on purpose: an app that boots against a database nobody chose is worse than one that refuses to start. */
  DATABASE_URL: z.string().min(1),
  /** At least 32 bytes; `@blixis-io/auth` refuses a weaker secret at boot as well. */
  JWT_SECRET: z.string().min(32),
  /** Origins a browser may call this API from, comma separated. */
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((value) => value.split(",").map((origin) => origin.trim()).filter((origin) => origin !== "")),
  /** How many reverse proxies you run in front of the server (a load balancer is 1). 0 trusts no forwarded header. */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  /** Requests per minute per client address, across all routes. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  /** Sign-in, sign-up and refresh attempts per minute per client address. Much stricter: this is where guessing happens. */
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  /** Requests per minute per API key, counted after the key is verified (a person is limited by address only). */
  API_KEY_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(600),
  /** How long the outbox relay waits when nothing is due. `0` turns the relay off in this process (run it elsewhere, or only in tests). */
  OUTBOX_POLL_MS: z.coerce.number().int().min(0).default(1000),
  /** Failed deliveries before an event is parked for a human. */
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const { CONFIG, ConfigModule } = defineConfigModule(AppConfigSchema);
