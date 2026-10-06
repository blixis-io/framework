import { defineHealthModule } from "@blixis-io/health";

/** One per process. `health.middleware` goes in the application's middleware; providers register their checks on `HEALTH`. */
export const { health, HEALTH, HealthModule } = defineHealthModule();
