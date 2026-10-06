import { defineAuthModule } from "@blixis-io/auth";
import { z } from "zod";

export const ClaimsSchema = z.object({ sub: z.string(), email: z.string() });
export type Claims = z.infer<typeof ClaimsSchema>;

export const { AuthModule, AUTH_SERVICE, getCurrentUser } = defineAuthModule(ClaimsSchema);
