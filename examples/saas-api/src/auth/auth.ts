import { defineAuthModule, RequireScopes } from "@blixis-io/auth";
import { z } from "zod";

/**
 * `spaceId` is set only for an API key: a key acts as a service in exactly one space, and the tenancy guard refuses it
 * everywhere else. A person's token has no `spaceId` and acts in every space they are a member of.
 */
export const ClaimsSchema = z.object({ sub: z.string(), email: z.string(), spaceId: z.string().optional() });
export type Claims = z.infer<typeof ClaimsSchema>;

export const { AuthModule, AUTH_SERVICE, getCurrentUser, getCurrentApiKey } = defineAuthModule(ClaimsSchema);

/** What a key may be given. Routes name the one they need with `@RequireScopes`; a person's token is not held to scopes. */
export const API_KEY_SCOPES = ["projects:read", "projects:write"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export { RequireScopes };
